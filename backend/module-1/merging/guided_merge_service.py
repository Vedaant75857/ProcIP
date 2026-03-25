"""Core service for guided merge workflow."""

from __future__ import annotations

import difflib
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from shared.ai import call_ai_json
from shared.db import (
    get_meta,
    lookup_sql_name,
    quote_id,
    read_table,
    read_table_columns,
    set_meta,
    table_exists,
    table_row_count,
    drop_table,
    column_stats,
)
from shared.db.stats_ops import column_distinct_values

from merging.ai.prompts import (
    SYSTEM_PROMPT_BASE_RECOMMENDATION,
    SYSTEM_PROMPT_COLUMN_CLASSIFICATION,
)
from merging.column_metadata import (
    COLUMN_METADATA,
    fuzzy_match_column,
    get_color_for_eligibility,
)


def _normalize_col(name: str) -> str:
    return name.lower().strip().replace(" ", "_").replace("-", "_")


# ---------------------------------------------------------------------------
# Step 0: Recommend Base File
# ---------------------------------------------------------------------------

def recommend_base_file(
    conn: sqlite3.Connection, session_id: str, api_key: str | None
) -> dict[str, Any]:
    schema = get_meta(conn, "groupSchemaTableRows") or []
    if not schema:
        raise ValueError("No appended groups found. Complete the append step first.")

    if len(schema) == 1:
        g = schema[0]
        return {
            "recommended": g["group_id"],
            "reasoning": "Only one table available — auto-selected as base.",
            "rankings": [{"group_id": g["group_id"], "score": 100, "reason": "Only table"}],
        }

    tables_meta = []
    for g in schema:
        gid = g["group_id"]
        sql_name = lookup_sql_name(conn, gid)
        if not sql_name or not table_exists(conn, sql_name):
            continue
        cols = read_table_columns(conn, sql_name)
        rows = table_row_count(conn, sql_name)
        sample = read_table(conn, sql_name, 5)
        tables_meta.append({
            "group_id": gid, "group_name": g.get("group_name", gid),
            "rows": rows, "columns": cols, "column_count": len(cols),
            "sample_values": {c: [str(r.get(c, "")) for r in sample[:3]] for c in cols[:10]},
        })

    if not tables_meta:
        raise ValueError("No valid tables found for base recommendation.")

    if not api_key or not api_key.strip():
        best = max(tables_meta, key=lambda t: t["rows"] * t["column_count"])
        return {
            "recommended": best["group_id"],
            "reasoning": f"Auto-selected by cell count ({best['rows']} × {best['column_count']}). Provide an API key for AI recommendation.",
            "rankings": [
                {"group_id": t["group_id"], "score": int(100 * (t["rows"] * t["column_count"]) / max(1, best["rows"] * best["column_count"])), "reason": f"{t['rows']} rows × {t['column_count']} cols"}
                for t in sorted(tables_meta, key=lambda t: t["rows"] * t["column_count"], reverse=True)
            ],
        }

    try:
        result = call_ai_json(SYSTEM_PROMPT_BASE_RECOMMENDATION, tables_meta, api_key)
        return result
    except Exception:
        best = max(tables_meta, key=lambda t: t["rows"] * t["column_count"])
        return {
            "recommended": best["group_id"],
            "reasoning": f"AI call failed — auto-selected by cell count ({best['rows']} × {best['column_count']}).",
            "rankings": [
                {"group_id": t["group_id"], "score": int(100 * (t["rows"] * t["column_count"]) / max(1, best["rows"] * best["column_count"])), "reason": f"{t['rows']} rows × {t['column_count']} cols"}
                for t in sorted(tables_meta, key=lambda t: t["rows"] * t["column_count"], reverse=True)
            ],
        }


# ---------------------------------------------------------------------------
# Step 2: Find Common Columns (header + value overlap)
# ---------------------------------------------------------------------------

def find_common_columns(
    conn: sqlite3.Connection, base_sql_name: str, source_sql_name: str
) -> list[dict[str, Any]]:
    base_cols = read_table_columns(conn, base_sql_name)
    source_cols = read_table_columns(conn, source_sql_name)
    if not base_cols or not source_cols:
        return []

    results: list[dict[str, Any]] = []
    matched_base: set[str] = set()
    matched_source: set[str] = set()

    # Pass 1: Normalized header matching
    base_norm = {_normalize_col(c): c for c in base_cols}
    source_norm = {_normalize_col(c): c for c in source_cols}
    for bn, bc in base_norm.items():
        if bn in source_norm:
            sc = source_norm[bn]
            matched_base.add(bc)
            matched_source.add(sc)
            results.append({
                "base_col": bc,
                "source_col": sc,
                "match_type": "header_exact",
                "overlap_pct": None,
                "is_strong": True,
            })

    # Fuzzy header matching for unmatched
    unmatched_base_norm = {n: c for n, c in base_norm.items() if c not in matched_base}
    unmatched_source_norm = {n: c for n, c in source_norm.items() if c not in matched_source}
    if unmatched_base_norm and unmatched_source_norm:
        src_keys = list(unmatched_source_norm.keys())
        for bn, bc in unmatched_base_norm.items():
            fuzzy = difflib.get_close_matches(bn, src_keys, n=1, cutoff=0.8)
            if fuzzy:
                sn = fuzzy[0]
                sc = unmatched_source_norm[sn]
                matched_base.add(bc)
                matched_source.add(sc)
                src_keys.remove(sn)
                results.append({
                    "base_col": bc,
                    "source_col": sc,
                    "match_type": "header_fuzzy",
                    "overlap_pct": None,
                    "is_strong": False,
                })

    # Pre-fetch ALL distinct values in parallel for unmatched columns
    unmatched_base = [c for c in base_cols if c not in matched_base]
    unmatched_source = [c for c in source_cols if c not in matched_source]

    distinct_cache: dict[tuple[str, str], set[str]] = {}

    cols_to_fetch = [(base_sql_name, c) for c in unmatched_base] + [(source_sql_name, c) for c in unmatched_source]
    for t, c in cols_to_fetch:
        distinct_cache[(t, c)] = set(_get_distinct_str(conn, t, c))

    # Pass 2: Exact value overlap using pre-fetched distinct values
    for bc in unmatched_base:
        base_distinct = distinct_cache.get((base_sql_name, bc), set())
        if not base_distinct:
            continue
        best_overlap = 0.0
        best_source = None
        for sc in unmatched_source:
            if sc in matched_source:
                continue
            source_distinct = distinct_cache.get((source_sql_name, sc), set())
            if not source_distinct:
                continue
            intersection = base_distinct & source_distinct
            overlap = len(intersection) / len(base_distinct)
            if overlap > best_overlap:
                best_overlap = overlap
                best_source = sc

        if best_source and best_overlap > 0.3:
            results.append({
                "base_col": bc,
                "source_col": best_source,
                "match_type": "value_overlap",
                "overlap_pct": round(best_overlap * 100, 1),
                "is_strong": best_overlap >= 0.85,
            })
            matched_base.add(bc)
            matched_source.add(best_source)
            unmatched_source = [c for c in unmatched_source if c != best_source]

    # Compute overlap for header-matched pairs in parallel
    header_pairs_needing_overlap = [r for r in results if r["overlap_pct"] is None]
    if header_pairs_needing_overlap:
        pair_cols = set()
        for r in header_pairs_needing_overlap:
            pair_cols.add((base_sql_name, r["base_col"]))
            pair_cols.add((source_sql_name, r["source_col"]))
        missing_cols = [(t, c) for t, c in pair_cols if (t, c) not in distinct_cache]
        for t, c in missing_cols:
            distinct_cache[(t, c)] = set(_get_distinct_str(conn, t, c))

        for r in header_pairs_needing_overlap:
            base_distinct = distinct_cache.get((base_sql_name, r["base_col"]), set())
            source_distinct = distinct_cache.get((source_sql_name, r["source_col"]), set())
            if base_distinct:
                intersection = base_distinct & source_distinct
                r["overlap_pct"] = round(len(intersection) / len(base_distinct) * 100, 1)
            else:
                r["overlap_pct"] = 0.0

    results.sort(key=lambda x: x.get("overlap_pct") or 0, reverse=True)
    return results


def _get_distinct_str(conn: sqlite3.Connection, table: str, col: str, limit: int = 2000) -> list[str]:
    """Get distinct non-null string values for a column, capped at `limit` for speed."""
    tbl = quote_id(table)
    qc = quote_id(col)
    rows = conn.execute(
        f"SELECT DISTINCT CAST({qc} AS TEXT) AS v FROM {tbl} WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != '' LIMIT ?",
        (limit,),
    ).fetchall()
    return [r["v"] for r in rows]


def classify_single_column(col_name: str) -> dict[str, str]:
    """Classify a single column using COLUMN_METADATA fuzzy matching (no LLM)."""
    match = fuzzy_match_column(col_name)
    if match:
        return {
            "category": match["category"],
            "eligibility": match["eligibility"],
            "color": get_color_for_eligibility(match["eligibility"]),
        }
    return {"category": "unknown", "eligibility": "low", "color": "grey"}


def classify_all_columns(columns: list[str]) -> dict[str, dict[str, str]]:
    """Classify every column in a list using COLUMN_METADATA. Returns {col_name: {category, eligibility, color}}."""
    return {col: classify_single_column(col) for col in columns}


# ---------------------------------------------------------------------------
# Step 3: Classify Common Columns (with optional LLM fallback)
# ---------------------------------------------------------------------------

def classify_columns(
    conn: sqlite3.Connection,
    session_id: str,
    api_key: str | None,
    common_columns: list[dict[str, Any]],
    base_sql_name: str = "",
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    needs_llm: list[tuple[int, dict[str, Any]]] = []

    # First pass: classify everything possible via COLUMN_METADATA (instant)
    for cc in common_columns:
        base_col = cc["base_col"]
        source_col = cc["source_col"]
        match_base = fuzzy_match_column(base_col)
        match_source = fuzzy_match_column(source_col)
        best_match = match_base or match_source

        if best_match:
            results.append({
                **cc,
                "category": best_match["category"],
                "eligibility": best_match["eligibility"],
                "color": get_color_for_eligibility(best_match["eligibility"]),
                "match_source": "metadata",
            })
        elif api_key and api_key.strip():
            idx = len(results)
            results.append({**cc, "category": "unknown", "eligibility": "low", "color": "grey", "match_source": "pending"})
            needs_llm.append((idx, cc))
        else:
            results.append({
                **cc,
                "category": "unknown",
                "eligibility": "low",
                "color": "grey",
                "match_source": "none",
            })

    # Second pass: pre-fetch samples (DB), then fire ALL LLM calls in parallel (no DB)
    if needs_llm and api_key:
        has_base_table = base_sql_name and table_exists(conn, base_sql_name)
        samples_cache: dict[str, list] = {}
        if has_base_table:
            for _idx, cc in needs_llm:
                bc = cc["base_col"]
                if bc not in samples_cache:
                    samples_cache[bc] = column_distinct_values(conn, base_sql_name, bc, 20)

        def _classify_via_llm(idx: int, cc: dict, samples: list) -> tuple[int, str, str]:
            try:
                ai_result = call_ai_json(
                    SYSTEM_PROMPT_COLUMN_CLASSIFICATION,
                    {"column_name": cc["base_col"], "sample_values": samples, "column_metadata_reference": COLUMN_METADATA},
                    api_key,
                )
                return (idx, ai_result.get("category", "weak"), ai_result.get("eligibility", "low"))
            except Exception:
                return (idx, "weak", "low")

        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [
                pool.submit(_classify_via_llm, idx, cc, samples_cache.get(cc["base_col"], []))
                for idx, cc in needs_llm
            ]
            for fut in as_completed(futures):
                idx, category, eligibility = fut.result()
                results[idx]["category"] = category
                results[idx]["eligibility"] = eligibility
                results[idx]["color"] = get_color_for_eligibility(eligibility)
                results[idx]["match_source"] = "llm"

    return results


# ---------------------------------------------------------------------------
# Step 5: Simulate Join
# ---------------------------------------------------------------------------

def simulate_join(
    conn: sqlite3.Connection,
    base_sql: str,
    source_sql: str,
    key_pairs: list[dict[str, str]],
) -> dict[str, Any]:
    if not key_pairs:
        return {"error": "No key pairs provided."}

    base_key_exprs, source_key_exprs = [], []
    for kp in key_pairs:
        base_key_exprs.append(f"CAST({quote_id(kp['base_col'])} AS TEXT)")
        source_key_exprs.append(f"CAST({quote_id(kp['source_col'])} AS TEXT)")

    base_key = " || '|||' || ".join(base_key_exprs)
    source_key = " || '|||' || ".join(source_key_exprs)
    bt, st = quote_id(base_sql), quote_id(source_sql)

    # Single CTE-based query computes all metrics in 2 scans instead of 5
    row = conn.execute(f"""
        WITH bk AS (SELECT {base_key} AS k FROM {bt}),
             sk AS (SELECT {source_key} AS k FROM {st}),
             sk_agg AS (
                 SELECT k, COUNT(*) AS c FROM sk GROUP BY k
             ),
             dk AS (SELECT DISTINCT k FROM bk),
             ds AS (SELECT DISTINCT k FROM sk),
             matched AS (SELECT COUNT(*) AS cnt FROM bk WHERE k IN (SELECT k FROM ds)),
             unmatched_src AS (
                 SELECT COUNT(*) AS cnt FROM (SELECT k FROM ds EXCEPT SELECT k FROM dk)
             ),
             dup_src AS (SELECT COUNT(*) AS cnt FROM sk_agg WHERE c > 1),
             joined AS (
                 SELECT COUNT(*) AS cnt FROM bk
                 INNER JOIN sk_agg ON bk.k = sk_agg.k
             )
        SELECT
            (SELECT COUNT(*) FROM bk) AS base_rows,
            (SELECT COUNT(*) FROM sk) AS source_rows,
            (SELECT cnt FROM matched) AS matched_base,
            (SELECT cnt FROM unmatched_src) AS unmatched_source,
            (SELECT cnt FROM dup_src) AS dup_source,
            (SELECT cnt FROM joined) AS joined_rows
    """).fetchone()

    base_rows = row["base_rows"]
    source_rows = row["source_rows"]
    matched_base = row["matched_base"]
    match_rate = matched_base / base_rows if base_rows > 0 else 0
    explosion = row["joined_rows"] / base_rows if base_rows > 0 else 1.0

    return {
        "match_rate": round(match_rate * 100, 1),
        "row_explosion_factor": round(explosion, 2),
        "unmatched_base_count": base_rows - matched_base,
        "unmatched_source_count": row["unmatched_source"],
        "duplicate_source_keys": row["dup_source"],
        "estimated_null_rate": round((1.0 - match_rate) * 100, 1),
        "base_rows": base_rows,
        "source_rows": source_rows,
    }


# ---------------------------------------------------------------------------
# Step 5: Execute Merge (per-source)
# ---------------------------------------------------------------------------

def execute_merge(
    conn: sqlite3.Connection,
    session_id: str,
    base_sql: str,
    source_sql: str,
    key_pairs: list[dict[str, str]],
    pull_columns: list[str],
    source_group_id: str,
) -> dict[str, Any]:
    if not key_pairs:
        raise ValueError("At least one key pair is required.")

    result_table = f"_merge_step_{source_group_id}"
    bt = quote_id(base_sql)
    st = quote_id(source_sql)
    rt = quote_id(result_table)

    base_cols = read_table_columns(conn, base_sql)
    source_cols = read_table_columns(conn, source_sql)

    # Auto-deduplicate source (keep first row per key group)
    source_key_exprs = []
    for kp in key_pairs:
        source_key_exprs.append(f"CAST({quote_id(kp['source_col'])} AS TEXT)")
    source_key_expr = ", ".join(source_key_exprs)

    dedup_sql = f"""
        CREATE TEMP TABLE _dedup_source AS
        SELECT * FROM {st}
        WHERE rowid IN (
            SELECT MIN(rowid) FROM {st}
            GROUP BY {source_key_expr}
        )
    """
    conn.execute("DROP TABLE IF EXISTS _dedup_source")
    conn.execute(dedup_sql)

    # Build JOIN ON clause (cast to text)
    on_parts = []
    for kp in key_pairs:
        bc = quote_id(kp["base_col"])
        sc = quote_id(kp["source_col"])
        on_parts.append(f"CAST(b.{bc} AS TEXT) = CAST(s.{sc} AS TEXT)")
    on_clause = " AND ".join(on_parts)

    # Determine columns to pull
    key_source_cols = {kp["source_col"] for kp in key_pairs}
    effective_pull = [c for c in pull_columns if c in source_cols and c not in key_source_cols]
    if not effective_pull:
        effective_pull = [c for c in source_cols if c not in key_source_cols and c not in base_cols]

    # Build SELECT
    base_col_select = ", ".join(f"b.{quote_id(c)}" for c in base_cols)
    pull_col_select = ", ".join(f"s.{quote_id(c)}" for c in effective_pull)
    select_clause = base_col_select
    if pull_col_select:
        select_clause += ", " + pull_col_select

    # Execute LEFT JOIN
    drop_table(conn, result_table)
    merge_sql = f"""
        CREATE TABLE {rt} AS
        SELECT {select_clause}
        FROM {bt} b
        LEFT JOIN _dedup_source s ON {on_clause}
    """
    try:
        conn.execute(merge_sql)
        conn.commit()
    except Exception as exc:
        # Auto-cast retry: already casting to TEXT in ON clause
        raise ValueError(f"Merge execution failed: {exc}") from exc

    conn.execute("DROP TABLE IF EXISTS _dedup_source")

    result_rows = table_row_count(conn, result_table)
    result_cols_list = read_table_columns(conn, result_table)

    return {
        "result_table": result_table,
        "source_group_id": source_group_id,
        "rows": result_rows,
        "cols": len(result_cols_list),
        "columns_pulled": effective_pull,
        "key_pairs": key_pairs,
    }


# ---------------------------------------------------------------------------
# Validation Report
# ---------------------------------------------------------------------------

def generate_validation_report(
    conn: sqlite3.Connection,
    base_sql: str,
    source_sql: str,
    result_table: str,
    merge_log: dict[str, Any],
) -> dict[str, Any]:
    base_rows = table_row_count(conn, base_sql)
    result_rows = table_row_count(conn, result_table)

    col_stats_list = column_stats(conn, result_table)
    preview = read_table(conn, result_table, 50)

    key_pairs = merge_log.get("key_pairs", [])
    bt = quote_id(base_sql)
    st = quote_id(source_sql)

    # Unmatched base rows
    if key_pairs:
        base_key_exprs = []
        source_key_exprs = []
        for kp in key_pairs:
            base_key_exprs.append(f"CAST({quote_id(kp['base_col'])} AS TEXT)")
            source_key_exprs.append(f"CAST({quote_id(kp['source_col'])} AS TEXT)")

        base_key = " || '|||' || ".join(base_key_exprs)
        source_key = " || '|||' || ".join(source_key_exprs)

        try:
            unmatched_base_rows = conn.execute(f"""
                SELECT * FROM {bt}
                WHERE ({base_key}) NOT IN (SELECT {source_key} FROM {st})
                LIMIT 20
            """).fetchall()
            unmatched_base_preview = [dict(r) for r in unmatched_base_rows]
        except Exception:
            unmatched_base_preview = []

        try:
            unmatched_source_rows = conn.execute(f"""
                SELECT * FROM {st}
                WHERE ({source_key}) NOT IN (SELECT {base_key} FROM {bt})
                LIMIT 20
            """).fetchall()
            unmatched_source_preview = [dict(r) for r in unmatched_source_rows]
        except Exception:
            unmatched_source_preview = []
    else:
        unmatched_base_preview = []
        unmatched_source_preview = []

    return {
        "base_rows": base_rows,
        "result_rows": result_rows,
        "explosion_factor": round(result_rows / max(base_rows, 1), 2),
        "column_stats": col_stats_list,
        "preview": preview,
        "unmatched_base_preview": unmatched_base_preview,
        "unmatched_source_preview": unmatched_source_preview,
        "columns_pulled": merge_log.get("columns_pulled", []),
    }


# ---------------------------------------------------------------------------
# Finalize: combine all approved merges into final_merged
# ---------------------------------------------------------------------------

def finalize_merge(
    conn: sqlite3.Connection,
    session_id: str,
    approved_merges: list[dict[str, Any]],
) -> dict[str, Any]:
    if not approved_merges:
        raise ValueError("No approved merges to finalize.")

    base_group_id = approved_merges[0].get("base_group_id", "")
    base_sql = lookup_sql_name(conn, base_group_id) or ""
    if not base_sql or not table_exists(conn, base_sql):
        raise ValueError(f"Base table not found for group {base_group_id}.")

    bt = quote_id(base_sql)

    # Build final_merged by sequentially LEFT JOINing pulled columns from each source
    current_table = base_sql
    for idx, merge in enumerate(approved_merges):
        step_table = merge.get("result_table", "")
        if not step_table or not table_exists(conn, step_table):
            continue

        step_cols = read_table_columns(conn, step_table)
        current_cols = read_table_columns(conn, current_table)
        new_cols = [c for c in step_cols if c not in current_cols]

        if not new_cols:
            continue

        key_pairs = merge.get("key_pairs", [])
        if not key_pairs:
            continue

        ct = quote_id(current_table)
        stt = quote_id(step_table)

        on_parts = []
        for kp in key_pairs:
            bc = quote_id(kp["base_col"])
            on_parts.append(f"CAST(c.{bc} AS TEXT) = CAST(s.{bc} AS TEXT)")
        on_clause = " AND ".join(on_parts)

        current_select = ", ".join(f"c.{quote_id(c)}" for c in current_cols)
        new_select = ", ".join(f"s.{quote_id(c)}" for c in new_cols)

        temp_name = f"_final_build_{idx}"
        drop_table(conn, temp_name)
        conn.execute(f"""
            CREATE TABLE {quote_id(temp_name)} AS
            SELECT {current_select}, {new_select}
            FROM {ct} c
            LEFT JOIN {stt} s ON {on_clause}
        """)
        conn.commit()
        current_table = temp_name

    drop_table(conn, "final_merged")
    if current_table != base_sql:
        conn.execute(f"ALTER TABLE {quote_id(current_table)} RENAME TO final_merged")
    else:
        conn.execute(f"CREATE TABLE final_merged AS SELECT * FROM {bt}")
    conn.commit()

    set_meta(conn, "mergeBaseGroupId", base_group_id)
    set_meta(conn, "mergeApprovedSources", approved_merges)

    final_rows = table_row_count(conn, "final_merged")
    final_cols = read_table_columns(conn, "final_merged")
    preview = read_table(conn, "final_merged", 50)
    stats = column_stats(conn, "final_merged")

    # Clean up intermediate tables
    for merge in approved_merges:
        step_t = merge.get("result_table", "")
        if step_t and table_exists(conn, step_t):
            drop_table(conn, step_t)

    return {
        "final_table": "final_merged",
        "rows": final_rows,
        "cols": len(final_cols),
        "columns": final_cols,
        "preview": preview,
        "column_stats": stats,
        "approved_count": len(approved_merges),
    }


# ---------------------------------------------------------------------------
# Skip merge: single group -> final_merged
# ---------------------------------------------------------------------------

def skip_merge(conn: sqlite3.Connection, session_id: str, base_group_id: str) -> dict[str, Any]:
    base_sql = lookup_sql_name(conn, base_group_id)
    if not base_sql or not table_exists(conn, base_sql):
        raise ValueError(f"Table not found for group {base_group_id}")

    drop_table(conn, "final_merged")
    bt = quote_id(base_sql)
    conn.execute(f"CREATE TABLE final_merged AS SELECT * FROM {bt}")
    conn.commit()

    set_meta(conn, "mergeBaseGroupId", base_group_id)
    set_meta(conn, "mergeApprovedSources", [])

    rows = table_row_count(conn, "final_merged")
    cols = read_table_columns(conn, "final_merged")
    preview = read_table(conn, "final_merged", 50)
    stats = column_stats(conn, "final_merged")
    return {
        "final_table": "final_merged",
        "rows": rows,
        "cols": len(cols),
        "columns": cols,
        "preview": preview,
        "column_stats": stats,
        "skipped": True,
    }
