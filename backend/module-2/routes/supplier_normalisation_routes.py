"""Supplier and plant name normalisation via AI + SQL."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from flask import Blueprint, jsonify, request

from shared.ai import CostTracker, batch_ai_mapping
from shared.db import (
    all_registered_tables,
    column_distinct_values,
    get_meta,
    lookup_sql_name,
    quote_id,
    read_table_columns,
)

from state.app_state import app_state, clear_progress, get_conn, update_progress

supplier_normalisation_bp = Blueprint("supplier_normalisation", __name__)

_DISTINCT_LIMIT = 5000


def _load_supplier_prompts():
    path = (
        Path(__file__).resolve().parent.parent
        / "normalisation"
        / "supplier-normalisation"
        / "ai"
        / "prompts.py"
    )
    spec = importlib.util.spec_from_file_location("m2_supplier_prompts", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _resolve_table_key(conn, explicit: str | None) -> str:
    if explicit:
        if not lookup_sql_name(conn, explicit):
            raise ValueError("Unknown tableKey.")
        return explicit
    meta_key = get_meta(conn, "module2_default_table_key")
    if meta_key and lookup_sql_name(conn, meta_key):
        return meta_key
    reg = all_registered_tables(conn)
    if not reg:
        raise ValueError("No tables loaded for this session.")
    return reg[0]["table_key"]


def _find_column(columns: list[str], keywords: list[str], explicit: str | None) -> str | None:
    if explicit:
        if explicit in columns:
            return explicit
        for c in columns:
            if c.upper() == explicit.upper():
                return c
        return None
    cols_l = [str(c).lower() for c in columns]
    for kw in keywords:
        k = kw.lower()
        for i, cl in enumerate(cols_l):
            if k in cl:
                return columns[i]
    return None


def _apply_string_mapping(conn, table_sql: str, col: str, mapping: dict) -> int:
    tbl = quote_id(table_sql)
    qc = quote_id(col)
    updated = 0
    for old, new in mapping.items():
        if new is None or str(old) == str(new):
            continue
        cur = conn.execute(
            f"UPDATE {tbl} SET {qc} = ? WHERE {qc} = ?",
            (str(new), str(old)),
        )
        updated += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.commit()
    return updated


@supplier_normalisation_bp.route("/fix-supplier-names", methods=["POST"])
def fix_supplier_names():
    p = _load_supplier_prompts()
    try:
        body = request.get_json(silent=True) or {}
        conn = get_conn()
        tk = _resolve_table_key(conn, body.get("tableKey"))
        sql_name = lookup_sql_name(conn, tk)
        assert sql_name
        cols = read_table_columns(conn, sql_name)
        col = _find_column(
            cols,
            ["supplier", "vendor", "seller", "provider", "company name", "supplier name"],
            body.get("column"),
        )
        if not col:
            return jsonify({"error": "Could not resolve supplier name column."}), 400

        unique = column_distinct_values(conn, sql_name, col, limit=_DISTINCT_LIMIT)
        api_key = app_state.get("openai_api_key") or None
        clear_progress()
        update_progress(0, 1, "Supplier names: starting AI batches…")

        def _cb(done, total, eta):
            update_progress(done, total, "Supplier names: AI batches", eta_seconds=eta)

        mapping, tracker = batch_ai_mapping(
            unique,
            p.SYSTEM_PROMPT_FIX_SUPPLIER_NAMES,
            p.INSTRUCTIONS_FIX_SUPPLIER_NAMES,
            api_key=api_key,
            progress_cb=_cb,
            cost_tracker=CostTracker(),
        )
        applied = _apply_string_mapping(conn, sql_name, col, mapping)
        clear_progress()
        return jsonify(
            {
                "tableKey": tk,
                "column": col,
                "distinctInput": len(unique),
                "mappingKeys": len(mapping),
                "rowsTouched": applied,
                "cost": tracker.summary(),
            }
        )
    except ValueError as ve:
        clear_progress()
        return jsonify({"error": str(ve)}), 400
    except Exception as exc:
        clear_progress()
        return jsonify({"error": str(exc)}), 500


@supplier_normalisation_bp.route("/fix-plant-names", methods=["POST"])
def fix_plant_names():
    p = _load_supplier_prompts()
    try:
        body = request.get_json(silent=True) or {}
        conn = get_conn()
        tk = _resolve_table_key(conn, body.get("tableKey"))
        sql_name = lookup_sql_name(conn, tk)
        assert sql_name
        cols = read_table_columns(conn, sql_name)
        col = _find_column(
            cols,
            ["plant", "site", "location", "facility", "warehouse", "mill"],
            body.get("column"),
        )
        if not col:
            return jsonify({"error": "Could not resolve plant/site column."}), 400

        unique = column_distinct_values(conn, sql_name, col, limit=_DISTINCT_LIMIT)
        api_key = app_state.get("openai_api_key") or None
        clear_progress()
        update_progress(0, 1, "Plant names: starting AI batches…")

        def _cb(done, total, eta):
            update_progress(done, total, "Plant names: AI batches", eta_seconds=eta)

        mapping, tracker = batch_ai_mapping(
            unique,
            p.SYSTEM_PROMPT_FIX_PLANTS,
            p.INSTRUCTIONS_FIX_PLANTS,
            api_key=api_key,
            progress_cb=_cb,
            cost_tracker=CostTracker(),
        )
        applied = _apply_string_mapping(conn, sql_name, col, mapping)
        clear_progress()
        return jsonify(
            {
                "tableKey": tk,
                "column": col,
                "distinctInput": len(unique),
                "mappingKeys": len(mapping),
                "rowsTouched": applied,
                "cost": tracker.summary(),
            }
        )
    except ValueError as ve:
        clear_progress()
        return jsonify({"error": str(ve)}), 400
    except Exception as exc:
        clear_progress()
        return jsonify({"error": str(exc)}), 500
