"""SQL-based table cleaning: copy raw -> work table, transform, replace tbl__."""

from __future__ import annotations

import sqlite3
from typing import Any, Mapping

from shared.db import (
    column_stats,
    drop_table,
    quote_id,
    read_table,
    read_table_columns,
    register_table,
    safe_table_name,
    set_meta,
    table_exists,
    table_row_count,
)

from data_loading.service import (
    PREVIEW_ROWS,
    build_files_payload_from_db,
    build_inventory_from_db,
)


def _shadow_name(table_key: str) -> str:
    return safe_table_name("tmp_clean_b", table_key)


def _work_name(table_key: str) -> str:
    return safe_table_name("tmp_clean", table_key)


def _rebuild_from_select(
    conn: sqlite3.Connection,
    work: str,
    shadow: str,
    select_list_sql: str,
) -> None:
    q_work = quote_id(work)
    q_shadow = quote_id(shadow)
    drop_table(conn, shadow)
    conn.execute(f"CREATE TABLE {q_shadow} AS SELECT {select_list_sql} FROM {q_work}")
    conn.commit()
    drop_table(conn, work)
    conn.execute(f"ALTER TABLE {q_shadow} RENAME TO {q_work}")
    conn.commit()


def _delete_null_or_empty_rows(conn: sqlite3.Connection, table: str, columns: list[str]) -> None:
    if not columns:
        return
    tbl = quote_id(table)
    parts = [f"({quote_id(c)} IS NOT NULL AND TRIM({quote_id(c)}) != '')" for c in columns]
    cond = " OR ".join(parts)
    conn.execute(f"DELETE FROM {tbl} WHERE NOT ({cond})")
    conn.commit()


def _apply_case_and_trim(
    conn: sqlite3.Connection,
    table: str,
    columns: list[str],
    case_mode: str,
    trim_whitespace: bool,
) -> None:
    if case_mode not in ("upper", "lower") and not trim_whitespace:
        return
    assignments: list[str] = []
    for c in columns:
        qc = quote_id(c)
        expr = qc
        if case_mode == "upper":
            expr = f"UPPER({expr})"
        elif case_mode == "lower":
            expr = f"LOWER({expr})"
        if trim_whitespace:
            expr = f"TRIM({expr})"
        assignments.append(f"{qc} = {expr}")
    if not assignments:
        return
    conn.execute(f"UPDATE {quote_id(table)} SET {', '.join(assignments)}")
    conn.commit()


def _apply_column_types(
    conn: sqlite3.Connection,
    table: str,
    column_types: Mapping[str, Any],
    columns: list[str],
) -> None:
    col_set = set(columns)
    tbl = quote_id(table)
    for col, target in column_types.items():
        if col not in col_set:
            continue
        if not target or target == "string":
            continue
        qc = quote_id(col)
        if target == "number":
            conn.execute(
                f"""UPDATE {tbl}
                SET {qc} = CAST(CAST(TRIM({qc}) AS REAL) AS TEXT)
                WHERE TRIM({qc}) != ''
                  AND TRIM({qc}) GLOB '*[0-9]*'
                  AND TRIM({qc}) NOT GLOB '*[^0-9.eE+-]*'"""
            )
        elif target == "date":
            conn.execute(
                f"""UPDATE {tbl}
                SET {qc} = date(TRIM({qc}))
                WHERE date(TRIM({qc})) IS NOT NULL"""
            )
        conn.commit()


def _deduplicate_rows(conn: sqlite3.Connection, table: str, dedup_cols: list[str]) -> int:
    cols = read_table_columns(conn, table)
    existing = [c for c in dedup_cols if c in cols]
    if not existing:
        return 0
    before = table_row_count(conn, table)
    if before == 0:
        return 0
    tbl = quote_id(table)
    group_exprs = ", ".join(quote_id(c) for c in existing)
    conn.execute(
        f"""DELETE FROM {tbl}
        WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM {tbl} GROUP BY {group_exprs}
        )"""
    )
    conn.commit()
    return before - table_row_count(conn, table)


def clean_table_sql(
    conn: sqlite3.Connection,
    table_key: str,
    config: Mapping[str, Any],
) -> dict[str, Any]:
    raw_sql = safe_table_name("raw", table_key)
    if not table_exists(conn, raw_sql):
        raise ValueError(f'Table "{table_key}" not found.')

    remove_null_rows = bool(config.get("removeNullRows", False))
    remove_null_columns = bool(config.get("removeNullColumns", False))
    drop_columns = list(config.get("dropColumns") or [])
    case_mode = str(config.get("caseMode") or "upper")
    trim_whitespace = bool(config.get("trimWhitespace", True))
    column_types = config.get("columnTypes") or {}
    if not isinstance(column_types, Mapping):
        column_types = {}
    deduplicate_columns = list(config.get("deduplicateColumns") or [])

    work = _work_name(table_key)
    shadow = _shadow_name(table_key)

    drop_table(conn, work)
    drop_table(conn, shadow)
    conn.execute(f"CREATE TABLE {quote_id(work)} AS SELECT * FROM {quote_id(raw_sql)}")
    conn.commit()

    # 1. Drop columns
    if drop_columns:
        drop_set = set(drop_columns)
        cols = read_table_columns(conn, work)
        kept = [c for c in cols if c not in drop_set]
        if not kept:
            raise ValueError("Cannot drop all columns.")
        select_list = ", ".join(quote_id(c) for c in kept)
        _rebuild_from_select(conn, work, shadow, select_list)

    # 2. Remove null/empty rows
    if remove_null_rows:
        cols = read_table_columns(conn, work)
        _delete_null_or_empty_rows(conn, work, cols)

    # 3. Remove null/empty columns
    if remove_null_columns and table_row_count(conn, work) > 0:
        stats = column_stats(conn, work)
        kept = [s["column_name"] for s in stats if s.get("non_null_count", 0) > 0]
        if not kept:
            raise ValueError("All columns are empty; nothing to keep.")
        select_list = ", ".join(quote_id(c) for c in kept)
        _rebuild_from_select(conn, work, shadow, select_list)

    # 4-5. Case + trim
    cols = read_table_columns(conn, work)
    _apply_case_and_trim(conn, work, cols, case_mode, trim_whitespace)

    # 6. Column type conversion
    cols = read_table_columns(conn, work)
    _apply_column_types(conn, work, column_types, cols)

    # 7. Deduplication
    duplicates_removed = _deduplicate_rows(conn, work, deduplicate_columns)

    tbl_name = safe_table_name("tbl", table_key)
    drop_table(conn, tbl_name)
    conn.execute(f"ALTER TABLE {quote_id(work)} RENAME TO {quote_id(tbl_name)}")
    conn.commit()
    drop_table(conn, shadow)

    register_table(conn, table_key, tbl_name)

    inv = build_inventory_from_db(conn)
    files_payload = build_files_payload_from_db(conn)
    set_meta(conn, "inv", inv)
    set_meta(conn, "filesPayload", files_payload)

    out_cols = read_table_columns(conn, tbl_name)
    preview_rows = read_table(conn, tbl_name, PREVIEW_ROWS)
    inv_row = next((r for r in inv if r["table_key"] == table_key), None)

    return {
        "preview": {"columns": out_cols, "rows": preview_rows},
        "inventoryRow": inv_row,
        "duplicatesRemoved": duplicates_removed,
    }
