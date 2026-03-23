"""Data quality analysis on `final_merged` using SQL stats + AI profiler/auditor."""

from __future__ import annotations

import importlib.util
import os
from typing import Any

import sqlite3

from shared.db import column_stats, quote_id, read_table_columns, table_exists, table_row_count
from shared.ai import call_ai_json


def _load_mod(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


_insights_root = os.path.join(os.path.dirname(__file__), "..", "insights")
_prompts = _load_mod("insights_prompts", os.path.join(_insights_root, "ai", "prompts.py"))
_stats = _load_mod("insights_stats", os.path.join(_insights_root, "stats", "column_stats_computer.py"))

DATA_PROFILER_PROMPT = _prompts.DATA_PROFILER_PROMPT
QUALITY_AUDITOR_PROMPT = _prompts.QUALITY_AUDITOR_PROMPT
estimate_duplicate_rows = _stats.estimate_duplicate_rows


def _numeric_predicate(qc: str) -> str:
    t = f"TRIM(CAST({qc} AS TEXT))"
    return f"({t} GLOB '*[0-9]*' AND {t} NOT GLOB '*[^0-9.eE+-]*')"


def _enrich_column_stats(
    conn: sqlite3.Connection,
    table_name: str,
    columns: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Shared `column_stats` plus per-column numeric_ratio from SQL."""
    if not table_exists(conn, table_name):
        return []
    all_cols = read_table_columns(conn, table_name)
    if columns:
        allow = set(all_cols)
        cols = [c for c in columns if c in allow]
    else:
        cols = all_cols
    if not cols:
        return []
    tbl = quote_id(table_name)
    basic = column_stats(conn, table_name, cols)
    out: list[dict[str, Any]] = []
    for row in basic:
        col = row["column_name"]  # sqlite3.Row
        qc = quote_id(col)
        num_pred = _numeric_predicate(qc)
        r2 = conn.execute(
            f"""SELECT
                CAST(COUNT(CASE WHEN {num_pred} AND {qc} IS NOT NULL
                    AND TRIM(CAST({qc} AS TEXT)) != '' THEN 1 END) AS REAL)
                / MAX(COUNT(CASE WHEN {qc} IS NOT NULL
                    AND TRIM(CAST({qc} AS TEXT)) != '' THEN 1 END), 1) AS numeric_ratio
            FROM {tbl}"""
        ).fetchone()
        numeric_ratio = float(r2["numeric_ratio"] or 0) if r2 else 0.0
        base = {k: row[k] for k in row.keys()}
        out.append({**base, "numeric_ratio": numeric_ratio})
    return out


def run_analysis(
    conn: sqlite3.Connection,
    session_id: str,
    api_key: str,
    columns: list[str] | None = None,
) -> dict[str, Any]:
    """
    Run SQL column statistics on `final_merged`, then DATA_PROFILER_PROMPT and
    QUALITY_AUDITOR_PROMPT with that payload (no raw rows).
    """
    _ = session_id
    if not table_exists(conn, "final_merged"):
        raise ValueError("No result table found. Complete the merge step first.")

    selected_columns: list[str] = []
    if isinstance(columns, list):
        selected_columns = [str(c) for c in columns if isinstance(c, str) and str(c).strip()]

    total_rows = table_row_count(conn, "final_merged")
    column_stat_rows = _enrich_column_stats(conn, "final_merged", selected_columns or None)
    dup_est = estimate_duplicate_rows(conn, "final_merged")

    profiler_payload = {
        "table": "final_merged",
        "totalRows": total_rows,
        "columns": [
            {
                "name": c["column_name"],
                "non_null_count": c["non_null_count"],
                "null_count": c["null_count"],
                "fill_rate": c["fill_rate"],
                "distinct_count": c["distinct_count"],
                "numeric_ratio": c["numeric_ratio"],
            }
            for c in column_stat_rows
        ],
        "sourceTables": [],
    }

    try:
        profiler = call_ai_json(DATA_PROFILER_PROMPT, profiler_payload, api_key=api_key)
    except Exception:
        profiler = {
            "dataDescription": "Merged dataset",
            "columnRoles": [
                {"name": c["column_name"], "role": "auxiliary", "description": ""}
                for c in column_stat_rows
            ],
            "domainKeywords": [],
            "dataCharacteristics": "",
        }

    auditor_payload = {
        "table": "final_merged",
        "totalRows": total_rows,
        "columnStats": column_stat_rows,
        "profilerOutput": profiler,
        "crossTableConsistency": 1.0,
        "duplicateRowEstimate": dup_est,
    }
    try:
        auditor = call_ai_json(QUALITY_AUDITOR_PROMPT, auditor_payload, api_key=api_key)
    except Exception:
        avg_fill = (
            sum(float(c.get("fill_rate") or 0.0) for c in column_stat_rows) / len(column_stat_rows)
            if column_stat_rows
            else 0.0
        )
        auditor = {
            "overallScore": int(round(avg_fill * 100)),
            "completeness": avg_fill,
            "uniqueness": 0.0,
            "consistency": 1.0,
            "issues": [],
            "recommendations": [],
        }

    selected = [str(c) for c in (selected_columns or []) if isinstance(c, str) and c.strip()]
    if not selected:
        selected = [str(c["column_name"]) for c in column_stat_rows[:3]]
    selected_set = set(selected)

    role_map = {
        str(r.get("name")): {
            "role": str(r.get("role") or "auxiliary"),
            "description": str(r.get("description") or ""),
        }
        for r in (profiler.get("columnRoles") or [])
        if isinstance(r, dict) and r.get("name")
    }
    issues = [i for i in (auditor.get("issues") or []) if isinstance(i, dict)]
    recs = [str(r) for r in (auditor.get("recommendations") or []) if r]

    dq_columns: list[dict[str, Any]] = []
    consistency_columns: list[dict[str, Any]] = []
    usability_columns: list[dict[str, Any]] = []

    for c in column_stat_rows:
        col = str(c["column_name"])
        if col not in selected_set:
            continue
        fill = float(c.get("fill_rate") or 0.0)
        non_null = int(c.get("non_null_count") or 0)
        distinct = int(c.get("distinct_count") or 0)
        uniq_ratio = (distinct / max(non_null, 1)) if non_null > 0 else 0.0
        num_ratio = float(c.get("numeric_ratio") or 0.0)
        role = role_map.get(col, {}).get("role", "auxiliary")
        desc = role_map.get(col, {}).get("description", "")

        col_issues = [
            str(i.get("description") or "")
            for i in issues
            if str(i.get("column") or "") == col
        ]
        consistency_score = int(round((0.6 * fill + 0.4 * max(0.0, 1.0 - abs(0.5 - num_ratio))) * 100))
        quality_score = int(round((0.7 * fill + 0.3 * min(uniq_ratio, 1.0)) * 100))
        usability_score = int(round((0.55 * quality_score + 0.45 * consistency_score)))

        dq_columns.append(
            {
                "column": col,
                "overall_score": quality_score,
                "inferred_description": desc or f"{role} column",
                "inferred_type": "numeric" if num_ratio >= 0.8 else "text",
                "buckets": [
                    {
                        "range": "all",
                        "count": non_null,
                        "percentage": round(fill * 100, 2),
                        "quality": {
                            "clarity": min(100, int(round((1.0 - abs(0.5 - num_ratio)) * 100))),
                            "consistency": consistency_score,
                            "completeness": int(round(fill * 100)),
                            "issues": col_issues[:4],
                        },
                    }
                ],
                "key_issues": col_issues[:6],
            }
        )

        patterns: list[str] = []
        if num_ratio >= 0.8:
            patterns.append("mostly_numeric")
        elif num_ratio <= 0.2:
            patterns.append("mostly_text")
        else:
            patterns.append("mixed_numeric_text")
        if fill >= 0.95:
            patterns.append("high_fill")

        consistency_columns.append(
            {
                "column": col,
                "consistency_score": consistency_score,
                "detected_patterns": patterns,
                "violations": [
                    {
                        "severity": str(i.get("severity") or "low"),
                        "description": str(i.get("description") or ""),
                        "estimated_pct": round((1.0 - fill) * 100, 2),
                    }
                    for i in issues
                    if str(i.get("column") or "") == col
                ],
                "mixed_types": {
                    "detected": 0.2 < num_ratio < 0.8,
                    "details": "Column appears to mix numeric and text-like values."
                    if 0.2 < num_ratio < 0.8
                    else "",
                },
                "recommendations": recs[:3],
            }
        )

        enabled = ["filter", "group"]
        if num_ratio >= 0.8:
            enabled.extend(["sum", "avg"])
        if role in ("timestamp",):
            enabled.append("trend")

        usability_columns.append(
            {
                "column": col,
                "usability_rating": usability_score,
                "characterization": desc or f"Usable as {role}",
                "enabled_analyses": enabled,
                "potential_problems": col_issues[:4],
                "remediation": recs[:3],
            }
        )

    return {
        "table": "final_merged",
        "totalRows": total_rows,
        "columnStats": column_stat_rows,
        "profiler": profiler,
        "quality": {
            "overallScore": auditor.get("overallScore"),
            "completeness": auditor.get("completeness"),
            "uniqueness": auditor.get("uniqueness"),
            "consistency": auditor.get("consistency"),
            "issues": auditor.get("issues", []),
            "recommendations": auditor.get("recommendations", []),
        },
        "rawQuality": auditor,
        "dataQuality": {
            "columns": dq_columns,
        },
        "consistency": {
            "columns": consistency_columns,
            "cross_column_issues": [],
        },
        "usability": {
            "overall_assessment": str(profiler.get("dataDescription") or "Merged dataset quality summary"),
            "columns": usability_columns,
        },
    }
