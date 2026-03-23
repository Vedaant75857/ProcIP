"""Header normalisation orchestration — profile, match, classify, apply."""

from __future__ import annotations

import importlib.util
import os
import sys
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

_this_dir = os.path.dirname(os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)

from shared.db import (
    all_registered_tables,
    quote_id,
    read_table,
    read_table_columns,
    register_table,
    safe_table_name,
    set_meta,
    get_meta,
    table_exists,
    table_row_count,
    drop_table,
)
from shared.ai import call_ai_json


def _load_mod(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


_profiler_mod = _load_mod("hn_profiler", os.path.join(_this_dir, "profiler.py"))
_matcher_mod = _load_mod("hn_matcher", os.path.join(_this_dir, "deterministic_matcher.py"))
_aliases_mod = _load_mod("hn_aliases_svc", os.path.join(_this_dir, "aliases.py"))
_schema_mod = _load_mod("hn_schema", os.path.join(_this_dir, "schema_mapper.py"))
_prompts_mod = _load_mod("hn_prompts_svc", os.path.join(_this_dir, "ai", "prompts.py"))

profile_table_columns = _profiler_mod.profile_table_columns
score_deterministic = _matcher_mod.score_deterministic
STANDARD_FIELDS = _schema_mod.STANDARD_FIELDS
SYSTEM_PROMPT_HEADER_NORM_COLUMN = _prompts_mod.SYSTEM_PROMPT_HEADER_NORM_COLUMN
FIELD_ALIASES_LIST = _aliases_mod.FIELD_ALIASES_LIST
EXPECTED_DTYPE = _aliases_mod.EXPECTED_DTYPE
FIELD_TO_SEMANTIC_TAGS = _aliases_mod.FIELD_TO_SEMANTIC_TAGS

CONCURRENCY = 3
_VALID_STANDARD_FIELD_NAMES = {f["name"] for f in STANDARD_FIELDS}
_STD_FIELD_PAYLOAD = [
    {
        "id": f.get("id"),
        "name": f["name"],
        "type": f.get("type", ""),
        "description": f.get("description", ""),
        "aliases": FIELD_ALIASES_LIST.get(f["name"], []),
        "expected_dtype": EXPECTED_DTYPE.get(f["name"], "text"),
        "semantic_tags": FIELD_TO_SEMANTIC_TAGS.get(f["name"], []),
    }
    for f in STANDARD_FIELDS
]


# ---------------------------------------------------------------------------
# 1.  run_header_norm  — profile + deterministic + AI
# ---------------------------------------------------------------------------

def run_header_norm(
    conn: sqlite3.Connection,
    api_key: str | None,
) -> dict[str, Any]:
    """Profile all tbl__ tables, run deterministic + AI matching, return decisions."""
    registered = all_registered_tables(conn)
    tbl_entries = [
        r for r in registered
        if str(r.get("sql_name", "")).startswith("tbl__")
        and table_exists(conn, r["sql_name"])
    ]
    if not tbl_entries:
        raise ValueError("No inventory tables found. Complete the upload/cleaning step first.")

    all_tables: list[dict[str, Any]] = []

    for entry in tbl_entries:
        table_key = entry["table_key"]
        sql_name = entry["sql_name"]
        profiles = profile_table_columns(conn, sql_name)

        col_decisions: list[dict[str, Any]] = []
        ai_payloads: list[dict[str, Any]] = []
        det_results_cache: list[list[Any]] = []

        for prof in profiles:
            det_results = score_deterministic(prof.source_name, prof.sample_values, top_n=5)
            det_results_cache.append(det_results)
            det_hints = [m.to_dict() for m in det_results]
            ai_payloads.append({
                "profile": prof.to_dict(),
                "det_hints": det_hints,
            })

        ai_results = _run_ai_batch(ai_payloads, api_key)

        for idx, prof in enumerate(profiles):
            det_results = det_results_cache[idx] if idx < len(det_results_cache) else []
            ai_out = ai_results[idx]
            decision = _combine(prof.source_name, det_results, ai_out)
            col_decisions.append(decision)

        all_tables.append({
            "tableKey": table_key,
            "sqlName": sql_name,
            "totalRows": table_row_count(conn, sql_name),
            "totalCols": len(profiles),
            "decisions": col_decisions,
        })

    set_meta(conn, "headerNormDecisions", all_tables)

    return {
        "tables": all_tables,
        "standardFields": STANDARD_FIELDS,
    }


def _run_ai_batch(
    payloads: list[dict[str, Any]],
    api_key: str | None,
) -> list[dict[str, Any]]:
    """Run concurrent AI calls for a list of column payloads."""
    results: list[dict[str, Any]] = [{}] * len(payloads)
    failures: list[str] = []

    def _call(idx: int, payload: dict) -> tuple[int, dict[str, Any], str | None]:
        source_col = str(payload.get("profile", {}).get("source_name") or f"column_{idx}")
        user_obj = {
            "standard_fields": _STD_FIELD_PAYLOAD,
            "column": payload["profile"],
            "deterministic_hints": payload["det_hints"],
        }
        try:
            raw_resp = call_ai_json(SYSTEM_PROMPT_HEADER_NORM_COLUMN, user_obj, api_key)
            resp = _validate_ai_column_response(source_col, raw_resp)
            return idx, resp, None
        except Exception as exc:
            return idx, {}, f"{source_col}: {exc}"

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {executor.submit(_call, i, p): i for i, p in enumerate(payloads)}
        for future in as_completed(futures):
            idx, resp, failure = future.result()
            results[idx] = resp
            if failure:
                failures.append(failure)

    if failures:
        sample = "; ".join(failures[:5])
        remainder = len(failures) - min(len(failures), 5)
        extra = f" (+{remainder} more)" if remainder > 0 else ""
        raise ValueError(
            "Header normalization AI failed. "
            "The backend only enriches the payload; the LLM must make the final decision. "
            f"Failures: {sample}{extra}"
        )

    return results


def _validate_ai_column_response(source_col: str, raw_resp: Any) -> dict[str, Any]:
    if not isinstance(raw_resp, dict):
        raise ValueError("LLM response was not a JSON object.")

    suggested = raw_resp.get("suggested_std_field")
    if suggested is None or str(suggested).strip() == "":
        suggested_std_field = None
    else:
        suggested_std_field = str(suggested).strip()
        if suggested_std_field not in _VALID_STANDARD_FIELD_NAMES:
            raise ValueError(f"LLM returned unknown standard field '{suggested_std_field}'.")

    try:
        confidence = float(raw_resp.get("confidence", 0) or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("LLM confidence was not numeric.") from exc
    confidence = max(0.0, min(confidence, 1.0))

    raw_alts = raw_resp.get("top_alternatives") or []
    if not isinstance(raw_alts, list):
        raise ValueError("LLM top_alternatives was not a list.")
    top_alternatives: list[str] = []
    for alt in raw_alts:
        alt_name = str(alt or "").strip()
        if not alt_name:
            continue
        if alt_name not in _VALID_STANDARD_FIELD_NAMES:
            raise ValueError(f"LLM returned unknown alternative field '{alt_name}'.")
        if alt_name not in top_alternatives:
            top_alternatives.append(alt_name)

    return {
        "source_col": source_col,
        "suggested_std_field": suggested_std_field,
        "confidence": confidence,
        "reason": str(raw_resp.get("reason") or "").strip(),
        "top_alternatives": top_alternatives[:5],
    }


def _combine(
    source_col: str,
    det_results: list,
    ai_out: dict[str, Any],
) -> dict[str, Any]:
    """Use the LLM as the final decider and keep deterministic matching as evidence."""
    best_det = det_results[0] if det_results else None
    det_score = best_det.score if best_det else 0.0
    det_field = best_det.std_field if best_det else None

    ai_field = ai_out.get("suggested_std_field")
    ai_conf = float(ai_out.get("confidence", 0))
    ai_reason = ai_out.get("reason", "")
    ai_alts = ai_out.get("top_alternatives", [])

    if ai_field and ai_conf >= 0.84:
        action = "AUTO"
        suggested = ai_field
        confidence = ai_conf
    elif ai_field:
        action = "REVIEW"
        suggested = ai_field
        confidence = ai_conf
    else:
        action = "KEEP"
        suggested = None
        confidence = ai_conf

    top_alts = ai_alts[:5] if ai_alts else [m.std_field for m in det_results[:5]]

    return {
        "source_col": source_col,
        "suggested_std_field": suggested,
        "confidence": round(confidence, 4),
        "reason": ai_reason,
        "action": action,
        "top_alternatives": top_alts,
        "det_score": round(det_score, 4),
        "deterministic_top_match": det_field,
        "deterministic_top_score": round(det_score, 4),
    }


# ---------------------------------------------------------------------------
# 2.  apply_header_norm  — create hn__ tables from approved decisions
# ---------------------------------------------------------------------------

def apply_header_norm(
    conn: sqlite3.Connection,
    decisions: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Apply user-approved mapping decisions and create hn__ tables.

    *decisions* maps ``table_key`` → list of column decisions, each with:
      - source_col, action ("AUTO"|"REVIEW"|"DROP"|"KEEP"), mapped_to (str|None)
    """
    applied: list[dict[str, Any]] = []

    for table_key, col_decisions in decisions.items():
        sql_name = _resolve_tbl(conn, table_key)
        if not sql_name or not table_exists(conn, sql_name):
            continue

        select_parts: list[str] = []
        mapped_count = 0
        dropped_count = 0
        kept_count = 0

        for cd in col_decisions:
            src = cd["source_col"]
            action = cd.get("action", "KEEP")
            mapped_to = cd.get("mapped_to")

            if action == "DROP":
                dropped_count += 1
                continue

            if mapped_to and mapped_to.strip():
                select_parts.append(f'{quote_id(src)} AS {quote_id(mapped_to)}')
                mapped_count += 1
            else:
                select_parts.append(quote_id(src))
                kept_count += 1

        if not select_parts:
            continue

        hn_sql = safe_table_name("hn", table_key)
        drop_table(conn, hn_sql)

        select_clause = ", ".join(select_parts)
        conn.execute(
            f'CREATE TABLE {quote_id(hn_sql)} AS SELECT {select_clause} FROM {quote_id(sql_name)}'
        )
        conn.commit()

        register_table(conn, table_key, hn_sql)

        applied.append({
            "tableKey": table_key,
            "hnSqlName": hn_sql,
            "mapped": mapped_count,
            "dropped": dropped_count,
            "kept": kept_count,
        })

    _rebuild_meta(conn)

    set_meta(conn, "headerNormApplied", True)

    return {"appliedTables": applied}


def _resolve_tbl(conn: sqlite3.Connection, table_key: str) -> str | None:
    """Find the tbl__ SQL name for a table_key (ignoring hn__ if already applied)."""
    registered = all_registered_tables(conn)
    for r in registered:
        if r["table_key"] == table_key:
            name = r["sql_name"]
            if name.startswith("tbl__"):
                return name
            tbl_name = safe_table_name("tbl", table_key)
            if table_exists(conn, tbl_name):
                return tbl_name
    tbl_name = safe_table_name("tbl", table_key)
    if table_exists(conn, tbl_name):
        return tbl_name
    return None


def _rebuild_meta(conn: sqlite3.Connection) -> None:
    """Rebuild inv and filesPayload meta to reflect current table state."""
    from data_loading.service import build_inventory_from_db, build_files_payload_from_db
    set_meta(conn, "inv", build_inventory_from_db(conn))
    set_meta(conn, "filesPayload", build_files_payload_from_db(conn))


# ---------------------------------------------------------------------------
# 3.  get_table_preview  — first N rows for the review UI
# ---------------------------------------------------------------------------

def get_table_preview(
    conn: sqlite3.Connection,
    table_key: str,
    limit: int = 100,
) -> dict[str, Any]:
    """Return first *limit* rows of the tbl__ table for user review."""
    sql_name = _resolve_tbl(conn, table_key)
    if not sql_name or not table_exists(conn, sql_name):
        raise ValueError(f"Table not found for key: {table_key}")

    cols = read_table_columns(conn, sql_name)
    rows = read_table(conn, sql_name, limit)
    total = table_row_count(conn, sql_name)

    return {
        "tableKey": table_key,
        "columns": cols,
        "rows": [dict(r) for r in rows],
        "totalRows": total,
    }
