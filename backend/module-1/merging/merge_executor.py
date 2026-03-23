"""Chained left joins, CSV streaming, and multi-group preview."""

from __future__ import annotations

import csv
import io
import sqlite3
from typing import Any, Iterator

from db.join_ops import left_join_sql

from shared.db import (
    drop_table,
    lookup_sql_name,
    quote_id,
    read_table,
    read_table_columns,
    table_exists,
    table_row_count,
    iterate_table,
)


def _csv_escape_cell(val: Any) -> str:
    if val is None:
        return ""
    s = str(val)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="")
    w.writerow([s])
    return buf.getvalue().rstrip("\r\n")


def execute_chained_joins(
    conn: sqlite3.Connection,
    main_table: str,
    merge_keys: list[dict[str, Any]],
    dim_columns_to_add: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """
    For each merge plan with status proposed | manual | review_needed, run left_join_sql
    sequentially. Intermediate outputs are dropped; result is stored as ``final_merged``.
    """
    if not table_exists(conn, main_table):
        return {"error": "main table not found", "merge_exec": []}

    dim_columns_to_add = dim_columns_to_add or {}
    current_fact = main_table
    fact_sql_name = main_table
    merge_exec: list[dict[str, Any]] = []

    for plan_idx, plan in enumerate(merge_keys):
        if not isinstance(plan, dict):
            continue
        status = plan.get("status")
        if status not in ("proposed", "manual", "review_needed"):
            merge_exec.append({
                "dimension_group": plan.get("dimension_group"),
                "status": "skipped",
                "reason": "not executable for this status",
            })
            continue

        dim_gid = plan.get("dimension_group")
        if not dim_gid:
            continue
        dim_sql = lookup_sql_name(conn, str(dim_gid))
        if not dim_sql or not table_exists(conn, dim_sql):
            merge_exec.append({
                "dimension_group": dim_gid,
                "status": "skipped",
                "reason": "dimension table not found",
            })
            continue

        fact_keys = [plan.get("fact_key")]
        dim_keys = [plan.get("dim_key")]
        for ek in plan.get("extra_keys") or []:
            if isinstance(ek, dict):
                fk = ek.get("fact_key")
                dk = ek.get("dim_key")
                if fk and dk:
                    fact_keys.append(fk)
                    dim_keys.append(dk)
        fact_keys = [k for k in fact_keys if k]
        dim_keys = [k for k in dim_keys if k]
        if len(fact_keys) != len(dim_keys) or not fact_keys:
            merge_exec.append({
                "dimension_group": dim_gid,
                "status": "skipped",
                "reason": "invalid key lists",
            })
            continue

        cols_to_keep = dim_columns_to_add.get(str(dim_gid))
        if cols_to_keep is not None:
            cols_to_keep = list(cols_to_keep)
            if len(cols_to_keep) == 0:
                cols_to_keep = None

        output_table = f"_merge_step_{plan_idx}"
        dim_name_short = str(dim_gid)[:40]
        format_hints = plan.get("format_hints")

        before_cols = read_table_columns(conn, current_fact)
        before_rows = table_row_count(conn, current_fact)

        metrics = left_join_sql(
            conn,
            current_fact,
            dim_sql,
            fact_keys,
            dim_keys,
            output_table,
            cols_to_keep,
            dim_name_short,
            format_hints,
        )
        metrics["shape_before"] = [before_rows, len(before_cols)]

        if metrics.get("status") == "skipped":
            merge_exec.append(metrics)
            continue

        after_cols = read_table_columns(conn, output_table)
        metrics["shape_after"] = [table_row_count(conn, output_table), len(after_cols)]
        merge_exec.append(metrics)

        if current_fact != fact_sql_name:
            drop_table(conn, current_fact)
        current_fact = output_table

    final_name = "final_merged"
    drop_table(conn, final_name)
    if current_fact != fact_sql_name and table_exists(conn, current_fact):
        conn.execute(
            f"ALTER TABLE {quote_id(current_fact)} RENAME TO {quote_id(final_name)}"
        )
        conn.commit()
    else:
        conn.execute(
            f"CREATE TABLE {quote_id(final_name)} AS SELECT * FROM {quote_id(main_table)}"
        )
        conn.commit()

    final_cols = read_table_columns(conn, final_name)
    final_rows = table_row_count(conn, final_name)
    return {
        "merge_exec": merge_exec,
        "final_shape": {"rows": final_rows, "cols": len(final_cols)},
        "final_table": final_name,
    }


def generate_csv_stream(
    conn: sqlite3.Connection,
    table_name: str,
) -> Iterator[str]:
    """Yield CSV lines (including header) for Flask streaming responses."""
    if not table_exists(conn, table_name):
        yield ""
        return

    columns = read_table_columns(conn, table_name)
    if not columns:
        yield "\n"
        return

    yield ",".join(_csv_escape_cell(c) for c in columns) + "\n"
    for row in iterate_table(conn, table_name):
        yield ",".join(_csv_escape_cell(row.get(c)) for c in columns) + "\n"


def build_group_preview(
    conn: sqlite3.Connection,
    group_ids: list[str],
    limit: int = 50,
) -> list[dict[str, Any]]:
    """First ``limit`` rows per group (by registered SQL table)."""
    out: list[dict[str, Any]] = []
    for gid in group_ids:
        sql = lookup_sql_name(conn, gid)
        if not sql or not table_exists(conn, sql):
            out.append({
                "group_id": gid,
                "error": "table not found",
                "columns": [],
                "rows": [],
                "total_rows": 0,
            })
            continue
        cols = read_table_columns(conn, sql)
        rows = read_table(conn, sql, limit)
        out.append({
            "group_id": gid,
            "columns": cols,
            "rows": rows,
            "total_rows": table_row_count(conn, sql),
        })
    return out
