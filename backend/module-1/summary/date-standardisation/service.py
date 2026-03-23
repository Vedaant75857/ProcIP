"""Date column detection, format analysis, and standardisation via SQLite."""

from __future__ import annotations

import re
import sqlite3
import time
from datetime import datetime
from typing import Any

from shared.db import get_meta, quote_id, read_table_columns, set_meta, table_exists, table_row_count


_DATE_REGEXES = (
    re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}"),
    re.compile(r"^\d{1,2}[-/]\d{1,2}[-/]\d{4}"),
    re.compile(r"^\d{1,2}[-/]\d{1,2}[-/]\d{2}$"),
    re.compile(r"^\d{8}$"),
    re.compile(r"^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}"),
)

_TARGET_FORMATS = {
    "YYYY-MM-DD": "%Y-%m-%d",
    "ISO": "%Y-%m-%d",
    "DD/MM/YYYY": "%d/%m/%Y",
    "MM/DD/YYYY": "%m/%d/%Y",
}


def _looks_like_date(value: str) -> bool:
    s = value.strip()
    if not s:
        return False
    return any(p.search(s) for p in _DATE_REGEXES)


def _classify_format(sample: str) -> list[str]:
    s = sample.strip()
    out: list[str] = []
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        out.append("YYYY-MM-DD")
    if re.match(r"^\d{4}/\d{2}/\d{2}", s):
        out.append("YYYY/MM/DD")
    if re.match(r"^\d{1,2}/\d{1,2}/\d{4}", s):
        first, second = int(s.split("/")[0]), int(s.split("/")[1])
        if first > 12:
            out.append("DD/MM/YYYY")
        elif second > 12:
            out.append("MM/DD/YYYY")
        else:
            out.extend(["DD/MM/YYYY", "MM/DD/YYYY"])
    if re.match(r"^\d{1,2}-\d{1,2}-\d{4}", s):
        out.append("DD-MM-YYYY_or_MM-DD-YYYY")
    if re.match(r"^\d{8}$", s):
        out.append("YYYYMMDD")
    return out or ["unknown"]


def detect_date_columns(conn: sqlite3.Connection, table_name: str) -> dict[str, Any]:
    """
    Sample distinct random-like values per column, measure date-like regex hit rate.
    """
    if not table_exists(conn, table_name):
        return {"columns": [], "dateColumns": [], "totalRows": 0}
    cols = [c for c in read_table_columns(conn, table_name) if c != "_source_table"]
    total_rows = table_row_count(conn, table_name)
    tbl = quote_id(table_name)
    results: list[dict[str, Any]] = []

    for col in cols:
        qc = quote_id(col)
        sample_rows = conn.execute(
            f"""SELECT DISTINCT CAST({qc} AS TEXT) AS v FROM {tbl}
            WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != ''
            ORDER BY RANDOM() LIMIT 30"""
        ).fetchall()
        samples = [str(r["v"]) for r in sample_rows]

        check_rows = conn.execute(
            f"""SELECT CAST({qc} AS TEXT) AS v FROM {tbl}
            WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != ''
            LIMIT 200"""
        ).fetchall()
        hits = sum(1 for r in check_rows if _looks_like_date(str(r["v"])))
        hit_rate = hits / max(len(check_rows), 1)

        results.append(
            {
                "column": col,
                "samples": samples,
                "dateRegexHitRate": round(hit_rate, 4),
                "likelyDate": hit_rate >= 0.35 and len(samples) > 0,
            }
        )

    likely = [r for r in results if r["likelyDate"]]
    return {"columns": results, "dateColumns": likely, "totalRows": total_rows}


def analyze_date_formats(
    conn: sqlite3.Connection, table_name: str, column: str
) -> dict[str, Any]:
    """Distinct non-null values (cap) + heuristic format labels."""
    if not table_exists(conn, table_name):
        raise ValueError(f"Table {table_name!r} does not exist.")
    cols = read_table_columns(conn, table_name)
    if column not in cols:
        raise ValueError(f"Column {column!r} not found.")

    qc = quote_id(column)
    tbl = quote_id(table_name)
    total_rows = table_row_count(conn, table_name)
    null_count = conn.execute(
        f"""SELECT COUNT(*) AS c FROM {tbl}
        WHERE {qc} IS NULL OR TRIM(CAST({qc} AS TEXT)) = ''"""
    ).fetchone()["c"]

    values = [
        str(r["v"])
        for r in conn.execute(
            f"""SELECT DISTINCT CAST({qc} AS TEXT) AS v FROM {tbl}
            WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != ''
            LIMIT 2000"""
        ).fetchall()
    ]

    format_counts: dict[str, int] = {}
    for v in values:
        for fmt in _classify_format(v):
            format_counts[fmt] = format_counts.get(fmt, 0) + 1

    breakdown = sorted(
        [{"format": k, "count": v} for k, v in format_counts.items()],
        key=lambda x: -x["count"],
    )

    return {
        "column": column,
        "totalRows": total_rows,
        "nullCount": int(null_count),
        "nonNullCount": total_rows - int(null_count),
        "distinctSampled": len(values),
        "formatBreakdown": breakdown,
        "sampleValues": values[:25],
    }


def _parse_to_dt(val: str) -> datetime | None:
    s = val.strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(s[:10] if len(s) >= 10 else s, fmt)
        except ValueError:
            continue
    if re.match(r"^\d{8}$", s):
        try:
            return datetime.strptime(s, "%Y%m%d")
        except ValueError:
            pass
    return None


def standardize_dates(
    conn: sqlite3.Connection,
    table_name: str,
    column: str,
    target_format: str,
) -> dict[str, Any]:
    """
    Add `{column}_clean` and populate using SQLite UPDATE.
    Supports ISO and common slash-separated target formats.
    """
    target_key = str(target_format or "").strip().upper()
    if target_key not in _TARGET_FORMATS:
        raise ValueError("Unsupported target_format. Use YYYY-MM-DD, ISO, DD/MM/YYYY, or MM/DD/YYYY.")

    if not table_exists(conn, table_name):
        raise ValueError(f"Table {table_name!r} does not exist.")
    cols = read_table_columns(conn, table_name)
    if column not in cols:
        raise ValueError(f"Column {column!r} not found.")

    clean_col = f"{column}_clean"
    qc = quote_id(column)
    q_clean = quote_id(clean_col)
    tbl = quote_id(table_name)

    if clean_col not in cols:
        conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {q_clean} TEXT")
        conn.commit()

    # Bulk strategy:
    # 1) Build a temporary raw->clean mapping table from DISTINCT source values.
    # 2) Apply one UPDATE with a correlated lookup, avoiding row-by-row updates.
    non_null_count = conn.execute(
        f"""SELECT COUNT(*) AS c FROM {tbl}
        WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != ''"""
    ).fetchone()["c"]

    raw_values = [
        str(r["v"])
        for r in conn.execute(
            f"""SELECT DISTINCT CAST({qc} AS TEXT) AS v FROM {tbl}
            WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != ''"""
        ).fetchall()
    ]

    mapping_rows: list[tuple[str, str]] = []
    for raw in raw_values:
        dt = _parse_to_dt(raw)
        if dt:
            mapping_rows.append((raw, dt.strftime(_TARGET_FORMATS[target_key])))

    tmp_map = f"tmp_date_map_{int(time.time() * 1000)}"
    conn.execute(f"DROP TABLE IF EXISTS {quote_id(tmp_map)}")
    conn.execute(
        f"CREATE TEMP TABLE {quote_id(tmp_map)} (raw_val TEXT PRIMARY KEY, clean_val TEXT)"
    )
    if mapping_rows:
        conn.executemany(
            f"INSERT OR REPLACE INTO {quote_id(tmp_map)} (raw_val, clean_val) VALUES (?, ?)",
            mapping_rows,
        )

    conn.execute(f"UPDATE {tbl} SET {q_clean} = NULL")
    conn.execute(
        f"""UPDATE {tbl}
        SET {q_clean} = (
            SELECT m.clean_val FROM {quote_id(tmp_map)} m
            WHERE m.raw_val = CAST({qc} AS TEXT)
        )
        WHERE {qc} IS NOT NULL AND TRIM(CAST({qc} AS TEXT)) != ''"""
    )
    conn.execute(f"DROP TABLE IF EXISTS {quote_id(tmp_map)}")
    conn.commit()

    updated = conn.execute(
        f"""SELECT COUNT(*) AS c FROM {tbl}
        WHERE {q_clean} IS NOT NULL AND TRIM(CAST({q_clean} AS TEXT)) != ''"""
    ).fetchone()["c"]
    failed = int(non_null_count) - int(updated)

    return {
        "table": table_name,
        "sourceColumn": column,
        "cleanColumn": clean_col,
        "rowsUpdated": updated,
        "rowsFailed": failed,
        "targetFormat": target_key,
    }


def persist_date_format_map(
    conn: sqlite3.Connection, column: str, per_source_formats: dict[str, str]
) -> None:
    """Merge per-column source→format map into meta `dateFormatMap` (optional helper)."""
    existing = get_meta(conn, "dateFormatMap") or {}
    if not isinstance(existing, dict):
        existing = {}
    col_map = existing.get(column, {})
    if not isinstance(col_map, dict):
        col_map = {}
    col_map.update(per_source_formats)
    existing[column] = col_map
    set_meta(conn, "dateFormatMap", existing)
