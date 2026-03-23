"""Payment terms and date standardisation via AI + SQL."""

from __future__ import annotations

import importlib.util
import re
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

payment_terms_normalisation_bp = Blueprint("payment_terms_normalisation", __name__)

_DISTINCT_LIMIT = 5000

_SYSTEM_FIX_DATES = "Output JSON only."
_USER_FIX_DATES = """Convert each value to ISO 8601 calendar date YYYY-MM-DD when it is a date or unambiguous date-like text.
If the value is not a date, return it unchanged.
Input: {batch}
Return JSON ONLY as a flat object mapping each original string to the normalized string, e.g. {"01/15/2024": "2024-01-15"}."""


def _load_payment_prompts():
    path = (
        Path(__file__).resolve().parent.parent
        / "normalisation"
        / "payment-terms-normalisation"
        / "ai"
        / "prompts.py"
    )
    spec = importlib.util.spec_from_file_location("m2_payment_prompts", path)
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


def _ensure_column(conn, table_sql: str, col: str) -> None:
    cols = read_table_columns(conn, table_sql)
    if col in cols:
        return
    conn.execute(f"ALTER TABLE {quote_id(table_sql)} ADD COLUMN {quote_id(col)} TEXT")
    conn.commit()


def _slug(s: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", s.upper()).strip("_")[:35]


@payment_terms_normalisation_bp.route("/fix-terms", methods=["POST"])
def fix_terms():
    p = _load_payment_prompts()
    user_tpl = p.INSTRUCTIONS_FIX_TERMS.replace("{unique_values}", "{batch}")
    try:
        body = request.get_json(silent=True) or {}
        conn = get_conn()
        tk = _resolve_table_key(conn, body.get("tableKey"))
        sql_name = lookup_sql_name(conn, tk)
        assert sql_name
        cols = read_table_columns(conn, sql_name)
        src = _find_column(
            cols,
            ["payment term", "pay term", "terms", "inco term", "net days", "pmt term"],
            body.get("column"),
        )
        if not src:
            return jsonify({"error": "Could not resolve payment terms column."}), 400

        unique = column_distinct_values(conn, sql_name, src, limit=_DISTINCT_LIMIT)
        api_key = app_state.get("openai_api_key") or None
        clear_progress()
        update_progress(0, 1, "Payment terms: starting AI batches…")

        def _cb(done, total, eta):
            update_progress(done, total, "Payment terms: AI batches", eta_seconds=eta)

        mapping, tracker = batch_ai_mapping(
            unique,
            p.SYSTEM_PROMPT_FIX_TERMS,
            user_tpl,
            api_key=api_key,
            progress_cb=_cb,
            cost_tracker=CostTracker(),
        )

        base = _slug(src)
        d_col = f"{base}_PT_DAYS"
        disc_col = f"{base}_PT_DISCOUNT"
        doubt_col = f"{base}_PT_DOUBT"
        for c in (d_col, disc_col, doubt_col):
            _ensure_column(conn, sql_name, c)

        tbl = quote_id(sql_name)
        qs = quote_id(src)
        qd = quote_id(d_col)
        qdisc = quote_id(disc_col)
        qdoubt = quote_id(doubt_col)

        rows_touched = 0
        for old, meta in mapping.items():
            if not isinstance(meta, dict):
                continue
            days = str(meta.get("days", "") or "")
            discount = str(meta.get("discount", "") or "")
            doubt = str(meta.get("doubt", "") or "")
            cur = conn.execute(
                f"""UPDATE {tbl}
                    SET {qd} = ?, {qdisc} = ?, {qdoubt} = ?
                    WHERE {qs} = ?""",
                (days, discount, doubt, str(old)),
            )
            rows_touched += cur.rowcount or 0
        conn.commit()
        clear_progress()
        return jsonify(
            {
                "tableKey": tk,
                "sourceColumn": src,
                "daysColumn": d_col,
                "discountColumn": disc_col,
                "doubtColumn": doubt_col,
                "distinctInput": len(unique),
                "mappingKeys": len(mapping),
                "rowsTouched": rows_touched,
                "cost": tracker.summary(),
            }
        )
    except ValueError as ve:
        clear_progress()
        return jsonify({"error": str(ve)}), 400
    except Exception as exc:
        clear_progress()
        return jsonify({"error": str(exc)}), 500


@payment_terms_normalisation_bp.route("/fix-dates", methods=["POST"])
def fix_dates():
    try:
        body = request.get_json(silent=True) or {}
        conn = get_conn()
        tk = _resolve_table_key(conn, body.get("tableKey"))
        sql_name = lookup_sql_name(conn, tk)
        assert sql_name
        cols = read_table_columns(conn, sql_name)
        src = _find_column(
            cols,
            ["date", "due", "invoice date", "posting", "delivery", "po date", "created"],
            body.get("column"),
        )
        if not src:
            return jsonify({"error": "Could not resolve date column."}), 400

        unique = column_distinct_values(conn, sql_name, src, limit=_DISTINCT_LIMIT)
        api_key = app_state.get("openai_api_key") or None
        clear_progress()
        update_progress(0, 1, "Dates: starting AI batches…")

        def _cb(done, total, eta):
            update_progress(done, total, "Dates: AI batches", eta_seconds=eta)

        mapping, tracker = batch_ai_mapping(
            unique,
            _SYSTEM_FIX_DATES,
            _USER_FIX_DATES,
            api_key=api_key,
            progress_cb=_cb,
            cost_tracker=CostTracker(),
        )

        tbl = quote_id(sql_name)
        qs = quote_id(src)
        rows_touched = 0
        for old, new in mapping.items():
            if new is None or str(old) == str(new):
                continue
            cur = conn.execute(
                f"UPDATE {tbl} SET {qs} = ? WHERE {qs} = ?",
                (str(new), str(old)),
            )
            rows_touched += cur.rowcount or 0
        conn.commit()
        clear_progress()
        return jsonify(
            {
                "tableKey": tk,
                "column": src,
                "distinctInput": len(unique),
                "mappingKeys": len(mapping),
                "rowsTouched": rows_touched,
                "cost": tracker.summary(),
            }
        )
    except ValueError as ve:
        clear_progress()
        return jsonify({"error": str(ve)}), 400
    except Exception as exc:
        clear_progress()
        return jsonify({"error": str(exc)}), 500
