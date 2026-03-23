"""Merge setup, execution, match-rate, compatibility, and normalize export."""

from __future__ import annotations

import os
import sys
import sqlite3
from itertools import combinations
from typing import Any

_this_dir = os.path.dirname(os.path.abspath(__file__))
_backend_dir = os.path.normpath(os.path.join(_this_dir, ".."))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from db.join_ops import (
    build_adaptive_normalization,
    check_dim_uniqueness,
    compute_composite_match_rate_sql,
    match_keys_distinct_sql,
    profile_all_columns,
)
from merging.ai.prompts import (
    SYSTEM_PROMPT_MERGE_KEY_SELECTION,
    CANDIDATE_DISCOVERY_PROMPT,
    SKEPTIC_PROMPT,
    EXECUTION_REVIEW_PROMPT,
    FINAL_ARBITER_PROMPT,
)
from merging.key_candidates import score_candidates
from merging.merge_executor import execute_chained_joins

from shared.ai import call_ai_json
from shared.db import (
    compute_overlap,
    get_meta,
    lookup_sql_name,
    read_table_columns,
    set_meta,
    table_exists,
    table_row_count,
)

try:
    from ai_core.procurement_reframer import reframe_procurement as _reframe
except Exception:
    _reframe = None

MAX_CANDIDATES_FOR_AI = 20
LOW_MATCH_RATE_THRESHOLD = 0.3


def _status_sort_key(row: dict[str, Any]) -> tuple[int, float]:
    order = {"proposed": 0, "review_needed": 1, "manual": 1, "no_match_found": 2, "blocked_risky_join": 3}
    st = row.get("status") or ""
    return (order.get(st, 9), -(float(row.get("confidence") or row.get("match_rate") or 0)))


def _no_match_row(dim_gid: str, rationale: str) -> dict[str, Any]:
    return {
        "dimension_group": dim_gid,
        "status": "no_match_found",
        "fact_key": None,
        "dim_key": None,
        "match_rate": 0.0,
        "confidence": 0.0,
        "low_quality_join": True,
        "rationale": rationale,
        "format_hints": [],
        "join_type": "many_to_many",
        "join_strategy": "direct",
    }


def _extend_keys_for_uniqueness(
    conn: sqlite3.Connection,
    dim_table: str,
    keys_f: list[str],
    keys_d: list[str],
    scored: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    u = check_dim_uniqueness(conn, dim_table, keys_d)
    if u["is_unique"]:
        return keys_f, keys_d
    base_f, base_d = keys_f[0], keys_d[0]
    for alt in scored[1:6]:
        fk = alt.get("main_column")
        dk = alt.get("dimension_column")
        if not fk or not dk or fk == base_f or dk in keys_d:
            continue
        trial_f = [base_f, fk]
        trial_d = [base_d, dk]
        if check_dim_uniqueness(conn, dim_table, trial_d)["is_unique"]:
            return trial_f, trial_d
    return keys_f, keys_d


def _run_4step_pipeline(
    conn: sqlite3.Connection,
    fact_table: str,
    dim_table: str,
    fact_cols: list[str],
    dim_cols: list[str],
    fact_profiles: list[dict[str, Any]],
    dim_profiles: list[dict[str, Any]],
    candidate_dicts: list[dict[str, Any]],
    api_key: str,
) -> tuple[str | None, str | None, float, str, str | None]:
    """Run the 4-step AI agent pipeline for merge key selection.

    Returns (fact_key, dim_key, confidence, rationale, status).
    Falls back to single-call SYSTEM_PROMPT_MERGE_KEY_SELECTION on failure.
    """
    # --- Step 1: Candidate Discovery ---
    step1_payload = {
        "fact_columns": fact_cols,
        "dim_columns": dim_cols,
        "fact_profiles": fact_profiles[:30],
        "dim_profiles": dim_profiles[:30],
        "candidates": candidate_dicts,
    }
    step1_out = call_ai_json(CANDIDATE_DISCOVERY_PROMPT, step1_payload, api_key)
    if not isinstance(step1_out, dict):
        step1_out = {}

    ranked = step1_out.get("ranked_candidates") or []
    top5 = ranked[:5] if ranked else candidate_dicts[:5]

    # --- Step 2: Skeptic — simulate joins for top candidates ---
    simulations: list[dict[str, Any]] = []
    for cand in top5:
        fk = cand.get("fact_keys", [cand.get("main_column")])
        dk = cand.get("dim_keys", [cand.get("dimension_column")])
        fk = [k for k in (fk or []) if k and k in fact_cols]
        dk = [k for k in (dk or []) if k and k in dim_cols]
        if fk and dk:
            sim = compute_composite_match_rate_sql(conn, fact_table, dim_table, fk, dk)
        else:
            sim = {"match_rate": 0}
        simulations.append({**cand, "simulation": sim})

    step2_payload = {
        "candidates": simulations,
        "fact_profiles": fact_profiles[:15],
        "dim_profiles": dim_profiles[:15],
    }
    step2_out = call_ai_json(SKEPTIC_PROMPT, step2_payload, api_key)
    if not isinstance(step2_out, dict):
        step2_out = {}

    # --- Step 3: Execution Review ---
    step3_payload = {
        "candidates": simulations,
        "skeptic_assessment": step2_out,
    }
    step3_out = call_ai_json(EXECUTION_REVIEW_PROMPT, step3_payload, api_key)
    if not isinstance(step3_out, dict):
        step3_out = {}

    # --- Step 4: Final Arbiter ---
    step4_payload = {
        "discovery": step1_out,
        "skeptic": step2_out,
        "execution_review": step3_out,
        "simulations": simulations,
    }
    step4_out = call_ai_json(FINAL_ARBITER_PROMPT, step4_payload, api_key)
    if not isinstance(step4_out, dict):
        step4_out = {}

    final_candidates = step4_out.get("final_candidates") or []
    sel_rank = int(step4_out.get("selected_candidate_rank") or 1)
    sel_idx = max(sel_rank - 1, 0)
    chosen = final_candidates[sel_idx] if sel_idx < len(final_candidates) else None

    if chosen:
        fk_list = chosen.get("fact_keys") or []
        dk_list = chosen.get("dim_keys") or []
        fact_key = fk_list[0] if fk_list else None
        dim_key = dk_list[0] if dk_list else None
        conf = float(chosen.get("confidence") or 0)
        rationale = str(step4_out.get("rationale") or chosen.get("reason") or "")
        status = step4_out.get("status")
        return fact_key, dim_key, conf, rationale, status

    # Fallback: single-call prompt
    ai_payload = {
        "fact_columns": fact_cols,
        "dim_columns": dim_cols,
        "candidates": candidate_dicts,
    }
    ai_out = call_ai_json(SYSTEM_PROMPT_MERGE_KEY_SELECTION, ai_payload, api_key)
    if isinstance(ai_out, dict):
        return (
            ai_out.get("fact_key"),
            ai_out.get("dim_key"),
            float(ai_out.get("confidence") or 0),
            str(ai_out.get("reasoning") or ""),
            None,
        )
    return None, None, 0.0, "", None


def smart_merge_setup_for_dim(
    conn: sqlite3.Connection,
    fact_table: str,
    dim_table: str,
    dim_gid: str,
    api_key: str | None,
    fact_cols: list[str] | None = None,
    fact_profiles: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if fact_cols is None:
        fact_cols = read_table_columns(conn, fact_table)
    dim_cols = read_table_columns(conn, dim_table)
    if not fact_cols or not dim_cols:
        return _no_match_row(dim_gid, "Missing columns on fact or dimension table")

    if fact_profiles is None:
        fact_profiles = profile_all_columns(conn, fact_table)
    dim_profiles = profile_all_columns(conn, dim_table)
    raw = match_keys_distinct_sql(conn, fact_table, dim_table, fact_profiles, dim_profiles)
    scored = score_candidates(raw, fact_cols, dim_cols)

    if not scored:
        return _no_match_row(dim_gid, "No SQL join candidates (no overlapping distinct values)")

    top_for_ai = scored[:MAX_CANDIDATES_FOR_AI]
    candidate_dicts = [
        {
            "candidateId": f"c{i}",
            "main_column": c["main_column"],
            "dimension_column": c["dimension_column"],
            "main_distinct": c["main_distinct"],
            "dim_distinct": c["dim_distinct"],
            "distinct_matches": c["distinct_matches"],
            "match_rate_distinct": c["match_rate_distinct"],
            "cardinality_diff_abs": c["cardinality_diff_abs"],
        }
        for i, c in enumerate(top_for_ai)
    ]

    ai_fact: str | None = None
    ai_dim: str | None = None
    ai_confidence = 0.0
    ai_reason = ""
    ai_status: str | None = None

    if api_key:
        try:
            ai_fact, ai_dim, ai_confidence, ai_reason, ai_status = _run_4step_pipeline(
                conn, fact_table, dim_table, fact_cols, dim_cols,
                fact_profiles or [], dim_profiles,
                candidate_dicts, api_key,
            )
        except Exception:
            ai_fact = ai_dim = None
            ai_confidence = 0.0
            ai_reason = ""
            ai_status = None

    if isinstance(ai_fact, str) and ai_fact.lower() in ("null", "none", ""):
        ai_fact = None
    if isinstance(ai_dim, str) and ai_dim.lower() in ("null", "none", ""):
        ai_dim = None

    if (
        ai_fact
        and ai_dim
        and isinstance(ai_fact, str)
        and isinstance(ai_dim, str)
        and ai_fact in fact_cols
        and ai_dim in dim_cols
    ):
        keys_f = [ai_fact]
        keys_d = [ai_dim]
    else:
        keys_f = [scored[0]["main_column"]]
        keys_d = [scored[0]["dimension_column"]]

    keys_f, keys_d = _extend_keys_for_uniqueness(conn, dim_table, keys_f, keys_d, scored)

    rate = compute_composite_match_rate_sql(conn, fact_table, dim_table, keys_f, keys_d)
    match_rate = float(rate.get("match_rate") or 0)

    if ai_confidence <= 0:
        ai_confidence = float(scored[0].get("composite_score") or 0)

    format_hints: list[dict[str, str]] = []
    for i in range(len(keys_f)):
        adaptive = build_adaptive_normalization(
            conn, fact_table, keys_f[i], dim_table, keys_d[i]
        )
        format_hints.append({
            "factExpr": adaptive["exprA"],
            "dimExpr": adaptive["exprB"],
        })

    uniq = check_dim_uniqueness(conn, dim_table, keys_d)
    join_type = "many_to_one" if uniq["is_unique"] else "many_to_many"

    if ai_status in ("proposed", "review_needed"):
        status = ai_status
    else:
        status = "proposed" if match_rate >= 0.05 else "review_needed"

    rationale = ai_reason or f"Keys: {'+'.join(keys_f)} \u2194 {'+'.join(keys_d)}"

    if api_key and _reframe:
        reframed = _reframe({"rationale": rationale}, api_key)
        rationale = reframed.get("rationale", rationale)

    out: dict[str, Any] = {
        "dimension_group": dim_gid,
        "status": status,
        "fact_key": keys_f[0],
        "dim_key": keys_d[0],
        "match_rate": match_rate,
        "distinct_matches": rate.get("distinct_matches"),
        "valid_fact_keys": rate.get("valid_fact_keys"),
        "confidence": ai_confidence,
        "rationale": rationale,
        "low_quality_join": match_rate < LOW_MATCH_RATE_THRESHOLD,
        "format_hints": format_hints,
        "join_type": join_type,
        "join_strategy": "direct",
    }
    if len(keys_f) > 1:
        out["extra_keys"] = [
            {"fact_key": keys_f[i], "dim_key": keys_d[i]} for i in range(1, len(keys_f))
        ]
    return out


def run_merge_setup(
    conn: sqlite3.Connection,
    session_id: str | None,
    api_key: str | None,
    main_group_id: str | None = None,
    dimension_group_ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Orchestrate smart merge setup for all dimensions (largest appended group = fact by default).
    ``session_id`` is accepted for API symmetry; the session is already bound to ``conn``.
    """
    _ = session_id
    schema_rows = get_meta(conn, "groupSchemaTableRows", []) or []
    if not schema_rows:
        return {"mergeKeys": [], "error": "groupSchemaTableRows missing — run append-execute first."}

    by_rows = sorted(schema_rows, key=lambda x: x.get("rows", 0), reverse=True)
    if not main_group_id:
        main_group_id = str(by_rows[0].get("group_id") or "")
    if dimension_group_ids is None:
        dimension_group_ids = [
            str(r.get("group_id"))
            for r in by_rows
            if r.get("group_id") and str(r.get("group_id")) != main_group_id
        ]

    fact_sql = lookup_sql_name(conn, main_group_id)
    if not fact_sql or not table_exists(conn, fact_sql):
        return {"mergeKeys": [], "error": f"Invalid main group / table: {main_group_id}"}

    cached_fact_cols = read_table_columns(conn, fact_sql)
    cached_fact_profiles = profile_all_columns(conn, fact_sql) if cached_fact_cols else []

    merge_keys: list[dict[str, Any]] = []
    for dim_gid in dimension_group_ids:
        if dim_gid == main_group_id:
            continue
        dim_sql = lookup_sql_name(conn, dim_gid)
        if not dim_sql or not table_exists(conn, dim_sql):
            merge_keys.append(_no_match_row(dim_gid, "Dimension table not found"))
            continue
        try:
            merge_keys.append(
                smart_merge_setup_for_dim(
                    conn,
                    fact_sql,
                    dim_sql,
                    dim_gid,
                    api_key,
                    fact_cols=cached_fact_cols,
                    fact_profiles=cached_fact_profiles,
                )
            )
        except Exception as exc:
            merge_keys.append(_no_match_row(dim_gid, f"Setup error: {exc}"))

    merge_keys.sort(key=_status_sort_key)
    set_meta(conn, "mergeKeys", merge_keys)
    set_meta(conn, "mergeMainGroupId", main_group_id)
    return {"mergeKeys": merge_keys, "mainGroupId": main_group_id}


def run_merge_execute(
    conn: sqlite3.Connection,
    session_id: str | None,
    merge_keys: list[dict[str, Any]],
    api_key: str | None,
    main_group_id: str | None = None,
    dim_columns_to_add: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Chain left joins per proposed/manual/review plan; materialize ``final_merged``."""
    _ = session_id
    if main_group_id is None:
        main_group_id = get_meta(conn, "mergeMainGroupId")
    if not main_group_id:
        return {"error": "main_group_id required (pass from client or run merge-setup first)."}

    main_sql = lookup_sql_name(conn, main_group_id)
    if not main_sql or not table_exists(conn, main_sql):
        return {"error": "Main fact table not found."}

    result = execute_chained_joins(conn, main_sql, merge_keys, dim_columns_to_add)
    if result.get("error"):
        return result

    set_meta(conn, "mergeExecLog", result.get("merge_exec"))
    return {
        "merge_exec": result["merge_exec"],
        "final_shape": result["final_shape"],
        "final_table": result.get("final_table", "final_merged"),
    }


def compute_match_rate_for_keys(
    conn: sqlite3.Connection,
    fact_table: str,
    dim_table: str,
    fact_keys: list[str],
    dim_keys: list[str],
) -> dict[str, Any]:
    return compute_composite_match_rate_sql(conn, fact_table, dim_table, fact_keys, dim_keys)


def _analyze_group_pair(conn: sqlite3.Connection, ga: str, gb: str) -> dict[str, Any]:
    a, b = sorted((str(ga), str(gb)))
    sql_a = lookup_sql_name(conn, a)
    sql_b = lookup_sql_name(conn, b)
    if not sql_a or not table_exists(conn, sql_a) or not sql_b or not table_exists(conn, sql_b):
        return {
            "group_a": a,
            "group_b": b,
            "priority_score": 0.0,
            "shared_columns": [],
            "column_overlap_ratio": 0.0,
            "value_overlaps": [],
            "warnings": ["One or both tables missing"],
        }

    cols_a = set(read_table_columns(conn, sql_a))
    cols_b = set(read_table_columns(conn, sql_b))
    shared = sorted(cols_a & cols_b)
    union = cols_a | cols_b
    col_ratio = len(shared) / max(len(union), 1)

    value_overlaps: list[dict[str, Any]] = []
    for col in shared[:20]:
        ov = compute_overlap(conn, sql_a, col, sql_b, col)
        value_overlaps.append({"column": col, "distinct_overlap": ov})

    overlap_sum = sum(v["distinct_overlap"] for v in value_overlaps)
    priority = overlap_sum / max(len(shared), 1) if shared else 0.0
    rows_a = table_row_count(conn, sql_a)
    rows_b = table_row_count(conn, sql_b)
    row_ratio = min(rows_a, rows_b) / max(max(rows_a, rows_b), 1)
    priority_score = 0.7 * priority + 0.3 * row_ratio

    return {
        "group_a": a,
        "group_b": b,
        "priority_score": round(priority_score, 6),
        "shared_columns": shared,
        "column_overlap_ratio": round(col_ratio, 6),
        "value_overlaps": value_overlaps,
        "row_count_a": rows_a,
        "row_count_b": rows_b,
    }


def _priority_to_action(priority_score: float) -> str:
    if priority_score >= 0.55:
        return "merge"
    if priority_score >= 0.3:
        return "optional"
    return "skip"


def _column_category(name: str) -> str:
    n = (name or "").lower()
    if any(k in n for k in ("id", "code", "key", "number", "no")):
        return "identifier"
    if any(k in n for k in ("date", "time", "month", "year")):
        return "temporal"
    if any(k in n for k in ("amount", "price", "cost", "value", "qty", "quantity", "total")):
        return "measure"
    return "dimension"


def _decorate_compatibility_row(
    conn: sqlite3.Connection,
    row: dict[str, Any],
    main_sql: str | None = None,
    dim_sql: str | None = None,
) -> dict[str, Any]:
    p = float(row.get("priority_score") or 0.0)
    overlaps = sorted(
        list(row.get("value_overlaps") or []),
        key=lambda x: -int(x.get("distinct_overlap") or 0),
    )
    max_overlap = max((int(v.get("distinct_overlap") or 0) for v in overlaps), default=0)

    likely_join_keys = []
    for v in overlaps[:3]:
        col = str(v.get("column") or "")
        ov = int(v.get("distinct_overlap") or 0)
        if not col or ov <= 0:
            continue
        confidence = (ov / max_overlap) if max_overlap > 0 else 0.0
        likely_join_keys.append(
            {
                "fact_col": col,
                "dim_col": col,
                "confidence": round(confidence, 4),
            }
        )

    enrichment_columns: list[dict[str, str]] = []
    if main_sql and dim_sql and table_exists(conn, main_sql) and table_exists(conn, dim_sql):
        main_cols = set(read_table_columns(conn, main_sql))
        dim_cols = read_table_columns(conn, dim_sql)
        for c in dim_cols:
            if c in main_cols:
                continue
            enrichment_columns.append(
                {
                    "name": c,
                    "category": _column_category(c),
                    "value": "new_field",
                }
            )
            if len(enrichment_columns) >= 12:
                break

    shared_columns = row.get("shared_columns") or []
    rationale_bits = [
        f"{len(shared_columns)} shared columns",
        f"overlap score {int(round(p * 100))}/100",
    ]
    if likely_join_keys:
        lead = likely_join_keys[0]
        rationale_bits.append(f"best candidate key: {lead['fact_col']}")
    rationale = "; ".join(rationale_bits)

    warnings = list(row.get("warnings") or [])
    if not likely_join_keys:
        warnings.append("No strong key overlap found")
    if p < 0.3:
        warnings.append("Low compatibility score")

    return {
        **row,
        "action": _priority_to_action(p),
        "priority_score": int(round(p * 100)),
        "likely_join_keys": likely_join_keys,
        "enrichment_columns": enrichment_columns,
        "rationale": rationale,
        "warnings": warnings,
    }


def run_merge_compatibility(
    conn: sqlite3.Connection,
    session_id: str | None,
    groups: list[str],
    api_key: str | None = None,
) -> dict[str, Any]:
    """
    For each unordered pair in ``groups``, compute column overlap and value overlap.
    ``api_key`` reserved for future use.
    """
    _ = session_id, api_key
    if len(groups) < 2:
        return {"results": [], "error": "At least two group ids required in groups."}

    results = [
        _decorate_compatibility_row(conn, _analyze_group_pair(conn, x, y))
        for x, y in combinations(groups, 2)
    ]
    results.sort(key=lambda r: -float(r.get("priority_score") or 0))
    return {"results": results}


def run_merge_compatibility_main_to_dims(
    conn: sqlite3.Connection,
    session_id: str | None,
    main_group_id: str,
    dimension_group_ids: list[str],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Compare the main (fact) group to each dimension group only (legacy / UI shape)."""
    _ = session_id, api_key
    if not main_group_id or not dimension_group_ids:
        return {"results": [], "error": "mainGroupId and dimensionGroupIds required."}
    main_sql = lookup_sql_name(conn, main_group_id)
    results: list[dict[str, Any]] = []
    for d in dimension_group_ids:
        dim_sql = lookup_sql_name(conn, d)
        row = _analyze_group_pair(conn, main_group_id, d)
        decorated = _decorate_compatibility_row(conn, row, main_sql=main_sql, dim_sql=dim_sql)
        decorated["main_group_id"] = main_group_id
        decorated["dim_group_id"] = d
        results.append(decorated)
    results.sort(key=lambda r: -float(r.get("priority_score") or 0))
    return {"results": results}


def export_to_normalize(
    conn: sqlite3.Connection,
    session_id: str | None,
    table_name: str = "final_merged",
) -> dict[str, Any]:
    """Verify merged table exists; expose schema and size for Module 2."""
    _ = session_id
    sql_name = lookup_sql_name(conn, table_name) or table_name
    if not table_exists(conn, sql_name):
        return {"success": False, "error": f'Table "{table_name}" not found. Run merge-execute first.'}

    cols = read_table_columns(conn, sql_name)
    n = table_row_count(conn, sql_name)
    payload = {"table": sql_name, "columns": cols, "rows": n}
    set_meta(conn, "normalizeExport", payload)
    return {"success": True, "columns": cols, "rows": n, "table": sql_name}
