"""Summary / analysis / date / insights API routes."""

from __future__ import annotations

import importlib.util
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context

from shared.ai import call_ai_json
from shared.db import (
    all_registered_tables,
    get_meta,
    get_session_db,
    lookup_sql_name,
    read_table,
    read_table_columns,
    set_meta,
    table_exists,
    table_row_count,
)
from shared.db.stats_ops import column_distinct_values

from appending.service import run_append_execute, run_append_mapping, run_append_plan
from data_loading.service import (
    build_files_payload_from_db,
    build_inventory_from_db,
)
summary_bp = Blueprint("summary_bp", __name__)

_module_dir = os.path.dirname(os.path.abspath(__file__))
_summary_root = os.path.normpath(os.path.join(_module_dir, "..", "summary"))


def _load_service(module_qual: str, relative_path: str):
    path = os.path.join(_summary_root, relative_path)
    spec = importlib.util.spec_from_file_location(module_qual, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_analysis = _load_service("summary_analysis_service", os.path.join("analysis", "service.py"))
_date_std = _load_service("summary_date_std_service", os.path.join("date-standardisation", "service.py"))
_insights = _load_service("summary_insights_service", os.path.join("insights", "service.py"))
_hn_root = os.path.normpath(os.path.join(_module_dir, "..", "header-normalisation"))
_hn_service = _load_service("summary_header_norm_service", os.path.join("..", "header-normalisation", "service.py"))
_hn_schema = _load_service("summary_header_norm_schema", os.path.join("..", "header-normalisation", "schema_mapper.py"))
_hn_prompts = _load_service("summary_header_norm_prompts", os.path.join("..", "header-normalisation", "ai", "prompts.py"))

run_analysis = _analysis.run_analysis
run_procurement_analysis = _analysis.run_procurement_analysis
detect_date_columns = _date_std.detect_date_columns
analyze_date_formats = _date_std.analyze_date_formats
standardize_dates = _date_std.standardize_dates
run_insights = _insights.run_insights
run_pre_merge_analysis = _insights.run_pre_merge_analysis
run_chat = _insights.run_chat
run_header_norm = _hn_service.run_header_norm
apply_header_norm = _hn_service.apply_header_norm
STANDARD_FIELDS = _hn_schema.STANDARD_FIELDS
VIEW_CATEGORIES = _hn_schema.VIEW_CATEGORIES
VIEW_REQUIREMENTS = _hn_schema.VIEW_REQUIREMENTS
SYSTEM_PROMPT_PROCUREMENT_MAPPING = _hn_prompts.SYSTEM_PROMPT_PROCUREMENT_MAPPING


def _sample_formats(samples: list[str]) -> list[str]:
    out: list[str] = []
    for s in samples[:10]:
        t = str(s).strip()
        if not t:
            continue
        if "-" in t and len(t) >= 8 and t[:4].isdigit():
            out.append("YYYY-MM-DD")
        elif "/" in t and len(t) >= 8 and t[:4].isdigit():
            out.append("YYYY/MM/DD")
        elif "/" in t and len(t) >= 8:
            out.append("DD/MM/YYYY_or_MM/DD/YYYY")
        elif t.isdigit() and len(t) == 8:
            out.append("YYYYMMDD")
    seen: list[str] = []
    for fmt in out:
        if fmt not in seen:
            seen.append(fmt)
    return seen[:4]


def _build_chat_context(conn, body: dict) -> str:
    stage = body.get("stage")
    selected = body.get("selectedItem")
    keys = [
        "inv",
        "appendGroups",
        "groupSchemaTableRows",
        "mergeBaseGroupId",
        "mergeApprovedSources",
        "normalizeExport",
    ]
    meta_summary: dict[str, object] = {}
    for k in keys:
        v = get_meta(conn, k)
        if isinstance(v, list):
            meta_summary[k] = {"count": len(v), "sample": v[:3]}
        elif isinstance(v, dict):
            meta_summary[k] = {"keys": list(v.keys())[:20]}
        elif v is not None:
            meta_summary[k] = v
    payload = {
        "stage": stage,
        "selectedItem": selected,
        "meta": meta_summary,
    }
    return json.dumps(payload)


_PROC_MAPPING_CONCURRENCY = int(os.getenv("PROC_MAPPING_CONCURRENCY", "3"))
_SESSION_LOCK_GUARD = threading.Lock()
_SESSION_LOCKS: dict[str, threading.RLock] = {}


def _session_lock(session_id: str) -> threading.RLock:
    with _SESSION_LOCK_GUARD:
        lock = _SESSION_LOCKS.get(session_id)
        if lock is None:
            lock = threading.RLock()
            _SESSION_LOCKS[session_id] = lock
        return lock


def _table_artifact_rows_cols(conn, table_name: str) -> dict[str, int]:
    if not table_exists(conn, table_name):
        return {"rows": 0, "cols": 0}
    return {
        "rows": int(table_row_count(conn, table_name) or 0),
        "cols": len(read_table_columns(conn, table_name)),
    }


def _build_merge_result_from_table(conn, table_name: str = "final_merged") -> dict[str, Any] | None:
    if not table_exists(conn, table_name):
        return None
    shape = _table_artifact_rows_cols(conn, table_name)
    return {
        "final_table": table_name,
        "final_shape": shape,
        "report": {"final_shape": shape},
        "preview": read_table(conn, table_name, 50),
        "csv": None,
        "csvTruncated": True,
    }


def _auto_header_norm_decisions(conn) -> dict[str, list[dict[str, Any]]]:
    raw = get_meta(conn, "headerNormDecisions") or []
    out: dict[str, list[dict[str, Any]]] = {}
    for t in raw:
        if not isinstance(t, dict):
            continue
        tk = str(t.get("tableKey") or "").strip()
        if not tk:
            continue
        col_decisions: list[dict[str, Any]] = []
        for d in (t.get("decisions") or []):
            if not isinstance(d, dict):
                continue
            src = str(d.get("source_col") or "").strip()
            if not src:
                continue
            action = str(d.get("action") or "KEEP")
            mapped = d.get("suggested_std_field")
            col_decisions.append(
                {
                    "source_col": src,
                    "action": action,
                    "mapped_to": mapped if action in ("AUTO", "REVIEW") else None,
                }
            )
        if col_decisions:
            out[tk] = col_decisions
    return out


def _run_procurement_mapping(conn, api_key: str) -> dict[str, Any]:
    if not table_exists(conn, "final_merged"):
        raise ValueError("Session or final data not found.")

    columns = read_table_columns(conn, "final_merged")
    columns_context = [
        {"name": col, "examples": column_distinct_values(conn, "final_merged", col, 50)}
        for col in columns
    ]
    standard_fields_payload = [
        {"name": f["name"], "description": f.get("description", "")}
        for f in STANDARD_FIELDS
    ]

    all_results: list[dict[str, Any]] = []
    for i in range(0, len(columns_context), _PROC_MAPPING_CONCURRENCY):
        chunk = columns_context[i : i + _PROC_MAPPING_CONCURRENCY]

        def _call(col_ctx: dict[str, Any]) -> dict[str, Any]:
            return call_ai_json(
                SYSTEM_PROMPT_PROCUREMENT_MAPPING,
                {
                    "standard_fields": standard_fields_payload,
                    "column": {
                        "name": col_ctx["name"],
                        "examples": col_ctx["examples"],
                    },
                },
                api_key,
            )

        with ThreadPoolExecutor(max_workers=_PROC_MAPPING_CONCURRENCY) as executor:
            futures = {executor.submit(_call, c): c for c in chunk}
            for future in as_completed(futures):
                col_ctx = futures[future]
                try:
                    result = future.result()
                    mapping = result.get("mappings", [result])[0] if isinstance(result, dict) else result
                    if isinstance(mapping, dict):
                        all_results.append(
                            {
                                "uploaded_column": mapping.get("uploaded_column", col_ctx["name"]),
                                "best_match": mapping.get("best_match"),
                                "confidence": mapping.get("confidence", 0),
                                "top_3_alternatives": mapping.get("top_3_alternatives", []),
                                "reasoning": mapping.get("reasoning", ""),
                            }
                        )
                    else:
                        all_results.append(
                            {
                                "uploaded_column": col_ctx["name"],
                                "best_match": None,
                                "confidence": 0,
                                "top_3_alternatives": [],
                                "reasoning": "",
                            }
                        )
                except Exception:
                    all_results.append(
                        {
                            "uploaded_column": col_ctx["name"],
                            "best_match": None,
                            "confidence": 0,
                            "top_3_alternatives": [],
                            "reasoning": "",
                        }
                    )

    set_meta(conn, "procMappings", all_results)
    return {
        "mappings": all_results,
        "standardFields": STANDARD_FIELDS,
        "viewCategories": VIEW_CATEGORIES,
        "viewRequirements": VIEW_REQUIREMENTS,
    }


_OPERATION_SPECS: dict[str, dict[str, Any]] = {
    "header_norm_run": {
        "required_inputs": [],
        "required_artifacts": ["inv"],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["headerNormDecisions"],
    },
    "header_norm_apply": {
        "required_inputs": [],
        "required_artifacts": ["headerNormDecisions"],
        "requires_api_key": False,
        "auto_prereqs": ["header_norm_run"],
        "produces": ["headerNormApplied"],
    },
    "append_plan": {
        "required_inputs": [],
        "required_artifacts": ["filesPayload"],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["appendGroups"],
    },
    "append_mapping": {
        "required_inputs": [],
        "required_artifacts": ["appendGroups"],
        "requires_api_key": True,
        "auto_prereqs": ["append_plan"],
        "produces": ["appendGroupMappings"],
    },
    "append_execute": {
        "required_inputs": [],
        "required_artifacts": ["appendGroupMappings"],
        "requires_api_key": False,
        "auto_prereqs": ["append_mapping"],
        "produces": ["groupSchemaTableRows"],
    },
    "analysis_run": {
        "required_inputs": [],
        "required_artifacts": ["table:final_merged"],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["analysisLast"],
    },
    "date_detect": {
        "required_inputs": [],
        "required_artifacts": ["table:final_merged"],
        "requires_api_key": False,
        "auto_prereqs": [],
        "produces": ["dateDetectLast"],
    },
    "date_analyze": {
        "required_inputs": ["columns"],
        "required_artifacts": ["table:final_merged"],
        "requires_api_key": False,
        "auto_prereqs": [],
        "produces": ["dateAnalyzeLast"],
    },
    "date_standardize": {
        "required_inputs": ["columns"],
        "required_artifacts": ["table:final_merged"],
        "requires_api_key": False,
        "auto_prereqs": [],
        "produces": ["dateStandardizeLast"],
    },
    "procurement_mapping": {
        "required_inputs": [],
        "required_artifacts": ["table:final_merged"],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["procMappings"],
    },
    "append_datasets": {
        "required_inputs": ["tableKeys"],
        "required_artifacts": [],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["groupSchemaTableRows"],
    },
    "header_normalize": {
        "required_inputs": [],
        "required_artifacts": ["inv"],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["headerNormApplied"],
    },
    "append": {
        "required_inputs": [],
        "required_artifacts": ["filesPayload"],
        "requires_api_key": True,
        "auto_prereqs": [],
        "produces": ["groupSchemaTableRows"],
    },
}

_OPERATION_INPUT_HINTS: dict[str, dict[str, Any]] = {
    "header_norm_run": {},
    "header_norm_apply": {
        "decisions": {"type": "object", "required": False, "description": "Per-table column decisions map."},
    },
    "append_plan": {
        "filesPayload": {"type": "array", "required": False, "description": "Optional explicit files payload override."},
        "tableKeys": {"type": "array", "required": False, "description": "Optional table keys to scope append planning."},
    },
    "append_mapping": {
        "appendGroups": {"type": "array", "required": False, "description": "Append groups. Falls back to session meta."},
    },
    "append_execute": {
        "appendGroupMappings": {"type": "array", "required": False, "description": "Group mappings to execute."},
        "unassignedTables": {"type": "array", "required": False, "description": "Optional excluded table keys."},
    },
    "analysis_run": {
        "columns": {"type": "array", "required": False, "description": "Optional subset of columns for analysis."},
    },
    "date_detect": {
        "tableName": {"type": "string", "required": False, "description": "Table to inspect (default: final_merged)."},
    },
    "date_analyze": {
        "tableName": {"type": "string", "required": False, "description": "Table to inspect (default: final_merged)."},
        "columns": {"type": "array", "required": True, "description": "Columns to analyze."},
    },
    "date_standardize": {
        "tableName": {"type": "string", "required": False, "description": "Table to update (default: final_merged)."},
        "columns": {"type": "array", "required": True, "description": "Columns to standardize."},
        "targetFormat": {"type": "string", "required": False, "description": "YYYY-MM-DD|ISO|DD/MM/YYYY|MM/DD/YYYY"},
    },
    "procurement_mapping": {},
    "append_datasets": {
        "tableKeys": {"type": "array", "required": True, "description": "Table keys to append directly."},
        "groupId": {"type": "string", "required": False, "description": "Optional output group id."},
    },
    "header_normalize": {
        "tableKeys": {"type": "array", "required": False, "description": "Optional table keys to scope normalization."},
    },
    "append": {
        "tableKeys": {"type": "array", "required": False, "description": "Optional table keys to scope append planning."},
    },
}


def _artifact_exists(conn, artifact: str) -> bool:
    if artifact.startswith("table:"):
        return table_exists(conn, artifact.split(":", 1)[1])
    value = get_meta(conn, artifact)
    if value is None:
        return False
    if isinstance(value, (list, dict, str)):
        return len(value) > 0
    if isinstance(value, bool):
        return value
    return True


def _operation_is_ready(conn, operation: str) -> bool:
    spec = _OPERATION_SPECS.get(operation) or {}
    produces = spec.get("produces") or []
    if not produces:
        return False
    return all(_artifact_exists(conn, a) for a in produces)


def _missing_requirements(conn, operation: str, input_data: dict[str, Any], api_key: str | None) -> list[str]:
    spec = _OPERATION_SPECS.get(operation) or {}
    missing: list[str] = []
    for artifact in spec.get("required_artifacts") or []:
        if artifact == "filesPayload":
            explicit_files = input_data.get("filesPayload")
            explicit_keys = input_data.get("tableKeys")
            if (isinstance(explicit_files, list) and len(explicit_files) > 0) or (
                isinstance(explicit_keys, list) and len(explicit_keys) > 0
            ):
                continue
        if artifact == "appendGroups":
            explicit_groups = input_data.get("appendGroups")
            if isinstance(explicit_groups, list) and len(explicit_groups) > 0:
                continue
        if artifact == "appendGroupMappings":
            explicit_mappings = input_data.get("appendGroupMappings")
            if isinstance(explicit_mappings, list) and len(explicit_mappings) > 0:
                continue
        if artifact == "table:final_merged":
            explicit_table = input_data.get("tableName")
            if explicit_table and table_exists(conn, str(explicit_table)):
                continue
        if not _artifact_exists(conn, artifact):
            missing.append(f"artifact:{artifact}")
    for field in spec.get("required_inputs") or []:
        value = input_data.get(field)
        if value is None or value == "" or value == []:
            missing.append(f"input:{field}")
    if spec.get("requires_api_key") and not (api_key and str(api_key).strip()):
        missing.append("input:apiKey")
    return missing


def _apply_preferred_files_payload(conn, input_data: dict[str, Any]) -> None:
    files_payload = input_data.get("filesPayload")
    table_keys = input_data.get("tableKeys")
    if isinstance(files_payload, list) and files_payload:
        set_meta(conn, "filesPayload", files_payload)
        return
    if isinstance(table_keys, list) and table_keys:
        all_payload = build_files_payload_from_db(conn)
        wanted = {str(k) for k in table_keys}
        filtered = [f for f in all_payload if str(f.get("table_key")) in wanted]
        if filtered:
            set_meta(conn, "filesPayload", filtered)


def _execute_operation(conn, session_id: str, operation: str, input_data: dict[str, Any], api_key: str | None) -> dict[str, Any]:
    if operation == "header_norm_run":
        return run_header_norm(conn, api_key)

    if operation == "header_norm_apply":
        decisions = input_data.get("decisions")
        if not isinstance(decisions, dict) or not decisions:
            decisions = _auto_header_norm_decisions(conn)
        if not isinstance(decisions, dict) or not decisions:
            raise ValueError("Missing or invalid decisions.")
        return apply_header_norm(conn, decisions)

    if operation == "append_plan":
        _apply_preferred_files_payload(conn, input_data)
        return run_append_plan(conn, api_key)

    if operation == "append_mapping":
        append_groups = input_data.get("appendGroups")
        if append_groups is None:
            append_groups = get_meta(conn, "appendGroups") or []
        if not isinstance(append_groups, list) or not append_groups:
            raise ValueError("No append groups available.")
        result = run_append_mapping(conn, append_groups, api_key)
        set_meta(conn, "appendGroupMappings", result.get("appendGroupMappings") or [])
        return result

    if operation == "append_execute":
        mappings = input_data.get("appendGroupMappings")
        if mappings is None:
            mappings = get_meta(conn, "appendGroupMappings") or []
        if not isinstance(mappings, list) or not mappings:
            raise ValueError("No append mappings available.")
        unassigned = input_data.get("unassignedTables")
        if unassigned is None:
            raw_unassigned = get_meta(conn, "unassigned") or []
            unassigned = [
                str(u.get("table_key"))
                for u in raw_unassigned
                if isinstance(u, dict) and u.get("table_key")
            ]
        return run_append_execute(conn, mappings, unassigned)

    if operation == "analysis_run":
        columns = input_data.get("columns") or []
        if not isinstance(columns, list):
            columns = []
        result = run_analysis(conn, session_id, str(api_key or "").strip(), columns=columns)
        set_meta(conn, "analysisLast", result)
        return result

    if operation == "date_detect":
        table_name = str(input_data.get("tableName") or "final_merged")
        result = detect_date_columns(conn, table_name)
        set_meta(conn, "dateDetectLast", result)
        return result

    if operation == "date_analyze":
        table_name = str(input_data.get("tableName") or "final_merged")
        columns = input_data.get("columns") or []
        if not isinstance(columns, list) or not columns:
            raise ValueError("Select at least one column.")
        out = [analyze_date_formats(conn, table_name, str(col)) for col in columns]
        result = {"columns": out}
        set_meta(conn, "dateAnalyzeLast", result)
        return result

    if operation == "date_standardize":
        table_name = str(input_data.get("tableName") or "final_merged")
        columns = input_data.get("columns") or []
        target = str(input_data.get("targetFormat") or "YYYY-MM-DD")
        if not isinstance(columns, list) or not columns:
            raise ValueError("Select at least one column.")
        out = [standardize_dates(conn, table_name, str(col), target) for col in columns]
        result = {"results": out, "targetFormat": target}
        set_meta(conn, "dateStandardizeLast", result)
        return result

    if operation == "procurement_mapping":
        result = _run_procurement_mapping(conn, str(api_key or "").strip())
        return result

    if operation == "append_datasets":
        table_keys = [str(t) for t in (input_data.get("tableKeys") or []) if str(t).strip()]
        if not table_keys:
            raise ValueError("tableKeys is required.")
        group_id = str(input_data.get("groupId") or f"modular_group_{int(time.time())}")
        append_groups = [{"group_id": group_id, "tables": table_keys, "reason": "Modular append"}]
        set_meta(conn, "appendGroups", append_groups)
        set_meta(conn, "unassigned", [])
        mapping = run_append_mapping(conn, append_groups, api_key)
        set_meta(conn, "appendGroupMappings", mapping.get("appendGroupMappings") or [])
        executed = run_append_execute(conn, mapping.get("appendGroupMappings") or [], [])
        return {"appendGroups": append_groups, "appendGroupMappings": mapping.get("appendGroupMappings"), **executed}

    if operation == "header_normalize":
        norm_result = run_header_norm(conn, api_key)
        decisions = _auto_header_norm_decisions(conn)
        if decisions:
            apply_result = apply_header_norm(conn, decisions)
            norm_result["applyResult"] = apply_result
        return norm_result

    if operation == "append":
        _apply_preferred_files_payload(conn, input_data)
        plan_result = run_append_plan(conn, api_key)
        append_groups = plan_result.get("appendGroups") or []
        if not append_groups:
            return plan_result
        mapping = run_append_mapping(conn, append_groups, api_key)
        set_meta(conn, "appendGroupMappings", mapping.get("appendGroupMappings") or [])
        executed = run_append_execute(conn, mapping.get("appendGroupMappings") or [], [])
        return {**plan_result, "appendGroupMappings": mapping.get("appendGroupMappings"), **executed}

    raise ValueError(f"Unsupported operation: {operation}")


def _build_state_patch(conn) -> dict[str, Any]:
    patch: dict[str, Any] = {
        "inventory": build_inventory_from_db(conn),
        "filesPayload": get_meta(conn, "filesPayload") or [],
        "headerNormDecisions": get_meta(conn, "headerNormDecisions") or [],
        "headerNormStandardFields": STANDARD_FIELDS,
        "appendGroups": get_meta(conn, "appendGroups") or [],
        "appendGroupMappings": get_meta(conn, "appendGroupMappings") or [],
        "unassigned": get_meta(conn, "unassigned") or [],
        "groupSchema": get_meta(conn, "groupSchemaTableRows") or [],
        "groupSchemaTableRows": get_meta(conn, "groupSchemaTableRows") or [],
        "mergeBaseGroupId": get_meta(conn, "mergeBaseGroupId") or "",
        "mergeApprovedSources": get_meta(conn, "mergeApprovedSources") or [],
        "analysisResults": get_meta(conn, "analysisLast"),
        "dateDetectResult": get_meta(conn, "dateDetectLast"),
        "dateAnalyzeResult": get_meta(conn, "dateAnalyzeLast"),
        "dateStandardizeResult": get_meta(conn, "dateStandardizeLast"),
        "procurementMappings": get_meta(conn, "procMappings") or [],
        "standardFields": STANDARD_FIELDS,
        "viewCategories": VIEW_CATEGORIES,
        "viewRequirements": VIEW_REQUIREMENTS,
    }
    merged = _build_merge_result_from_table(conn, "final_merged")
    if merged:
        patch["mergeResult"] = merged
    return patch


def _build_artifact_summary(conn) -> dict[str, Any]:
    registry = all_registered_tables(conn)
    tables = [
        {"table_key": r.get("table_key"), "sql_name": r.get("sql_name")}
        for r in registry
    ]
    return {
        "meta": {
            "inv": bool(get_meta(conn, "inv")),
            "filesPayload": bool(get_meta(conn, "filesPayload")),
            "headerNormDecisions": bool(get_meta(conn, "headerNormDecisions")),
            "appendGroups": bool(get_meta(conn, "appendGroups")),
            "appendGroupMappings": bool(get_meta(conn, "appendGroupMappings")),
            "groupSchemaTableRows": bool(get_meta(conn, "groupSchemaTableRows")),
            "mergeBaseGroupId": bool(get_meta(conn, "mergeBaseGroupId")),
            "mergeApprovedSources": bool(get_meta(conn, "mergeApprovedSources")),
            "analysisLast": bool(get_meta(conn, "analysisLast")),
            "procMappings": bool(get_meta(conn, "procMappings")),
        },
        "tables": tables,
        "final_merged": _table_artifact_rows_cols(conn, "final_merged"),
    }


def _build_execution_catalog() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    graph: dict[str, list[str]] = {}
    for op, spec in _OPERATION_SPECS.items():
        graph[op] = list(spec.get("auto_prereqs") or [])
        items.append(
            {
                "id": op,
                "required_inputs": list(spec.get("required_inputs") or []),
                "required_artifacts": list(spec.get("required_artifacts") or []),
                "requires_api_key": bool(spec.get("requires_api_key")),
                "auto_prereqs": list(spec.get("auto_prereqs") or []),
                "produces": list(spec.get("produces") or []),
                "produced_artifacts": list(spec.get("produces") or []),
                "input_schema_hints": _OPERATION_INPUT_HINTS.get(op, {}),
            }
        )
    return {
        "operations": items,
        "prerequisite_graph": graph,
        "defaults": {
            "options": {"mode": "pipeline", "autoPrepare": True, "persist": True},
        },
    }


def execute_operation_kernel(
    session_id: str | None,
    operation: str,
    api_key: str | None,
    input_data: dict[str, Any] | None = None,
    options: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> tuple[dict[str, Any], int]:
    input_data = input_data if isinstance(input_data, dict) else {}
    options = options if isinstance(options, dict) else {}
    mode = str(options.get("mode") or "modular")
    auto_prepare = bool(options.get("autoPrepare", True))
    persist = bool(options.get("persist", True))

    if operation not in _OPERATION_SPECS:
        return {"ok": False, "error": f"Unsupported operation: {operation}"}, 400

    effective_session_id = str(session_id).strip() if session_id else uuid.uuid4().hex
    conn = get_session_db(effective_session_id)
    rid = (request_id or uuid.uuid4().hex[:12]).strip()

    lock = _session_lock(effective_session_id)
    with lock:
        executed_operations: list[str] = []
        auto_prepared: list[str] = []
        warnings: list[str] = []
        metrics: dict[str, Any] = {}

        def _run_one(op_name: str) -> dict[str, Any]:
            if auto_prepare:
                for prereq in (_OPERATION_SPECS.get(op_name, {}).get("auto_prereqs") or []):
                    if _operation_is_ready(conn, prereq):
                        continue
                    _run_one(prereq)
                    if prereq not in auto_prepared:
                        auto_prepared.append(prereq)

            missing = _missing_requirements(conn, op_name, input_data if op_name == operation else {}, api_key)
            if missing:
                raise ValueError(json.dumps({"missing_requirements": missing, "operation": op_name}))

            started = time.perf_counter()
            result = _execute_operation(conn, effective_session_id, op_name, input_data if op_name == operation else {}, api_key)
            metrics[op_name] = {"duration_ms": round((time.perf_counter() - started) * 1000, 1)}
            if op_name not in executed_operations:
                executed_operations.append(op_name)
            return result

        try:
            result_payload = _run_one(operation)
            artifacts = _build_artifact_summary(conn)
            state_patch = _build_state_patch(conn)
            if not persist:
                warnings.append("persist=false requested, but some operations persist by design for compatibility.")

            return (
                {
                    "ok": True,
                    "sessionId": effective_session_id,
                    "operation": operation,
                    "mode": mode,
                    "executed_operations": executed_operations,
                    "auto_prepared": auto_prepared,
                    "warnings": warnings,
                    "errors": [],
                    "metrics": metrics,
                    "artifacts": artifacts,
                    "statePatch": state_patch,
                    "result": result_payload,
                    "requestId": rid,
                },
                200,
            )
        except ValueError as exc:
            message = str(exc)
            try:
                payload = json.loads(message)
                return {
                    "ok": False,
                    "sessionId": effective_session_id,
                    "error": "Missing requirements",
                    "errors": [{"type": "missing_requirements", "details": payload.get("missing_requirements") or []}],
                    **payload,
                    "requestId": rid,
                }, 400
            except Exception:
                return {
                    "ok": False,
                    "sessionId": effective_session_id,
                    "error": message,
                    "errors": [{"type": "validation_error", "message": message}],
                    "requestId": rid,
                }, 400
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            return {
                "ok": False,
                "sessionId": effective_session_id,
                "error": message,
                "errors": [{"type": "execution_error", "message": message}],
                "requestId": rid,
            }, 500


@summary_bp.route("/execution/catalog", methods=["POST"])
def execution_catalog():
    try:
        return jsonify(_build_execution_catalog())
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/execution/state", methods=["GET"])
def execution_state():
    try:
        session_id = request.args.get("sessionId")
        if not session_id:
            return jsonify({"error": "Missing sessionId"}), 400
        conn = get_session_db(str(session_id))
        readiness = {
            op: {
                "ready": len(_missing_requirements(conn, op, {}, None)) == 0,
                "missing_requirements": _missing_requirements(conn, op, {}, None),
            }
            for op in _OPERATION_SPECS.keys()
        }
        return jsonify(
            {
                "sessionId": session_id,
                "readiness": readiness,
                "artifactSummary": _build_artifact_summary(conn),
                "statePatch": _build_state_patch(conn),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/execution/run", methods=["POST"])
def execution_run():
    try:
        body = request.get_json(force=True, silent=True) or {}
        operation = str(body.get("operation") or "").strip()
        session_id = body.get("sessionId")
        api_key = body.get("apiKey")
        options = body.get("options")
        input_data = body.get("input")
        payload, status = execute_operation_kernel(
            session_id=session_id,
            operation=operation,
            api_key=api_key,
            input_data=input_data if isinstance(input_data, dict) else {},
            options=options if isinstance(options, dict) else {},
            request_id=request.headers.get("X-Request-Id"),
        )
        return jsonify(payload), status
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 500


@summary_bp.route("/analysis/run", methods=["POST"])
def analysis_run():
    try:
        body = request.get_json(force=True, silent=True) or {}
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="analysis_run",
            api_key=body.get("apiKey"),
            input_data={"columns": body.get("columns") or []},
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        return jsonify(payload.get("result") or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/date-detect", methods=["POST"])
def date_detect():
    try:
        body = request.get_json(force=True, silent=True) or {}
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="date_detect",
            api_key=body.get("apiKey"),
            input_data={"tableName": body.get("tableName") or "final_merged"},
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        result = payload.get("result") or {}
        date_columns = []
        for row in result.get("dateColumns", []):
            confidence = int(round(float(row.get("dateRegexHitRate") or 0.0) * 100))
            sample_formats_seen = _sample_formats(list(row.get("samples") or []))
            date_columns.append(
                {
                    "column": row.get("column"),
                    "confidence": confidence,
                    "sample_formats_seen": sample_formats_seen,
                    "reasoning": f"{confidence}% of sampled values match date patterns",
                }
            )
        return jsonify(
            {
                **result,
                "dateColumns": date_columns,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/date-analyze", methods=["POST"])
def date_analyze():
    try:
        body = request.get_json(force=True, silent=True) or {}
        columns = body.get("columns") or []
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="date_analyze",
            api_key=body.get("apiKey"),
            input_data={"tableName": body.get("tableName") or "final_merged", "columns": columns},
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        result = payload.get("result") or {}
        out = []
        for row in (result.get("columns") or []):
            breakdown = list(row.get("formatBreakdown") or [])
            total_vals = int(row.get("nonNullCount") or 0)
            ambiguous = sum(int(b.get("count") or 0) for b in breakdown if "_or_" in str(b.get("format") or ""))
            unrecognized = sum(int(b.get("count") or 0) for b in breakdown if str(b.get("format") or "") == "unknown")
            shaped_breakdown = []
            for b in breakdown:
                c = int(b.get("count") or 0)
                shaped_breakdown.append(
                    {
                        "format": b.get("format"),
                        "count": c,
                        "percentage": round((c / max(total_vals, 1)) * 100, 2),
                    }
                )
            out.append(
                {
                    "column": row.get("column"),
                    "totalValues": total_vals,
                    "ambiguousCount": ambiguous,
                    "unrecognizedCount": unrecognized,
                    "formatBreakdown": shaped_breakdown,
                    "sourceBreakdown": [],
                    "sampleValues": row.get("sampleValues", []),
                }
            )
        return jsonify({"columns": out})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/date-standardize", methods=["POST"])
def date_standardize():
    try:
        body = request.get_json(force=True, silent=True) or {}
        target_format = body.get("targetFormat") or "YYYY-MM-DD"
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="date_standardize",
            api_key=body.get("apiKey"),
            input_data={
                "tableName": body.get("tableName") or "final_merged",
                "columns": body.get("columns") or [],
                "targetFormat": target_format,
            },
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        result = payload.get("result") or {}
        results = list(result.get("results") or [])
        shaped = []
        for r in results:
            converted = int(r.get("rowsUpdated") or 0)
            failed = int(r.get("rowsFailed") or 0)
            total = converted + failed
            confidence = int(round((converted / max(total, 1)) * 100))
            shaped.append(
                {
                    "column": r.get("sourceColumn"),
                    "cleanColumn": r.get("cleanColumn"),
                    "converted": converted,
                    "failed": failed,
                    "confidenceScore": confidence,
                    "targetFormat": r.get("targetFormat"),
                }
            )
        return jsonify({"columns": shaped, "results": results, "targetFormat": target_format})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/analysis/procurement-summary", methods=["POST"])
def procurement_summary():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        api_key = body.get("apiKey")
        if not session_id:
            return jsonify({"error": "Missing sessionId"}), 400
        if not (api_key and str(api_key).strip()):
            return jsonify({"error": "Missing API key"}), 400
        conn = get_session_db(session_id)
        result = run_procurement_analysis(conn, session_id, str(api_key).strip())
        set_meta(conn, "procurementAnalysis", result)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/group-insights", methods=["POST"])
def group_insights():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        api_key = body.get("apiKey")
        if not session_id:
            return jsonify({"error": "Missing sessionId"}), 400
        if not (api_key and str(api_key).strip()):
            return jsonify({"error": "Missing API key"}), 400
        conn = get_session_db(session_id)
        groups = body.get("groups")
        if groups is None:
            groups = get_meta(conn, "appendGroups")
        result = run_insights(conn, session_id, groups, str(api_key).strip())
        if "insights" not in result:
            reports = result.get("groupReports") or []
            result["insights"] = {
                str(r.get("groupId")): r.get("insights", {})
                for r in reports
            }
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/pre-merge-analysis", methods=["POST"])
def pre_merge_analysis():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        api_key = body.get("apiKey")
        if not session_id:
            return jsonify({"error": "Missing sessionId"}), 400
        if not (api_key and str(api_key).strip()):
            return jsonify({"error": "Missing API key"}), 400
        conn = get_session_db(session_id)
        result = run_pre_merge_analysis(conn, session_id, str(api_key).strip())
        if "should_merge" not in result:
            result["should_merge"] = bool(result.get("mergeHints"))
            result["rationale"] = str(result.get("narrative") or "")
        result.setdefault("dimension_recommendations", [])
        result.setdefault("recommended_fact_group", None)
        result.setdefault("skip_merge_reason", "" if result.get("should_merge") else str(result.get("rationale") or ""))
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@summary_bp.route("/chat", methods=["POST"])
def chat():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        messages = body.get("messages") or []
        message = body.get("message")
        if not message and isinstance(messages, list):
            user_msgs = [m for m in messages if isinstance(m, dict) and m.get("role") == "user" and m.get("content")]
            if user_msgs:
                message = user_msgs[-1].get("content")
        context = body.get("context") or ""
        api_key = body.get("apiKey")
        if not session_id or not message:
            return jsonify({"error": "Missing sessionId or message"}), 400
        conn = get_session_db(session_id)
        key = str(api_key).strip() if api_key else None
        if not context:
            context = _build_chat_context(conn, body)

        history = []
        if isinstance(messages, list):
            history = [
                {"role": str(m.get("role")), "content": str(m.get("content"))}
                for m in messages
                if isinstance(m, dict) and m.get("role") in ("user", "assistant")
            ]
        result = run_chat(
            conn,
            session_id,
            str(message),
            str(context),
            api_key=key,
            history=history,
        )

        if isinstance(messages, list) and messages:
            reply = str(result.get("reply") or "")

            def _event_stream():
                yield f"data: {json.dumps({'content': reply})}\n\n"
                yield "data: [DONE]\n\n"

            return Response(
                stream_with_context(_event_stream()),
                mimetype="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500
