"""Spend normalisation: currency conversion using Frankfurter (ECB) FX API + SQL."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from flask import Blueprint, jsonify, request

from shared.ai import CostTracker
from shared.db import (
    all_registered_tables,
    get_meta,
    lookup_sql_name,
    quote_id,
    read_table_columns,
)

from state.app_state import clear_progress, get_conn, update_progress

fx_rates_normalisation_bp = Blueprint("fx_rates_normalisation", __name__)


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


def _fetch_frankfurter_rate(from_ccy: str, to_ccy: str) -> float:
    a, b = from_ccy.strip().upper(), to_ccy.strip().upper()
    if a == b:
        return 1.0
    url = f"https://api.frankfurter.app/latest?from={a}&to={b}"
    req = urllib.request.Request(url, headers={"User-Agent": "DataConsolidationApp-Module2"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data: dict[str, Any] = json.loads(resp.read().decode())
    rates = data.get("rates") or {}
    if b not in rates:
        raise ValueError(f"No rate from {a} to {b} in FX response.")
    return float(rates[b])


def _ensure_column(conn, table_sql: str, col: str) -> None:
    cols = read_table_columns(conn, table_sql)
    if col in cols:
        return
    conn.execute(f"ALTER TABLE {quote_id(table_sql)} ADD COLUMN {quote_id(col)} TEXT")
    conn.commit()


@fx_rates_normalisation_bp.route("/normalize-spend", methods=["POST"])
def normalize_spend():
    clear_progress()
    tracker = CostTracker()
    try:
        body = request.get_json(silent=True) or {}
        conn = get_conn()
        tk = _resolve_table_key(conn, body.get("tableKey"))
        sql_name = lookup_sql_name(conn, tk)
        assert sql_name
        cols = read_table_columns(conn, sql_name)

        amt_col = _find_column(
            cols,
            ["spend", "amount", "cost", "value", "total", "price", "po value"],
            body.get("amountColumn"),
        )
        cur_col = _find_column(
            cols,
            ["currency", "curr", "ccy", "iso currency", "curr code"],
            body.get("currencyColumn"),
        )
        if not amt_col or not cur_col:
            return jsonify(
                {"error": "Could not resolve amount and/or currency columns.", "columns": cols}
            ), 400

        target = (body.get("targetCurrency") or "USD").strip().upper()
        out_col = (body.get("outputColumn") or f"NORMALIZED_SPEND_{target}").strip().upper()
        _ensure_column(conn, sql_name, out_col)

        tbl = quote_id(sql_name)
        q_amt = quote_id(amt_col)
        q_cur = quote_id(cur_col)
        q_out = quote_id(out_col)

        rows = conn.execute(
            f"""SELECT DISTINCT UPPER(TRIM({q_cur})) AS ccy
                FROM {tbl}
                WHERE {q_cur} IS NOT NULL AND TRIM({q_cur}) != ''
                LIMIT 500""",
        ).fetchall()
        distinct = [str(r["ccy"]) for r in rows if r["ccy"]]

        update_progress(0, max(len(distinct), 1), "FX: fetching rates…")
        rates: dict[str, float] = {}
        for i, ccy in enumerate(distinct):
            try:
                rates[ccy] = _fetch_frankfurter_rate(ccy, target)
            except (urllib.error.URLError, ValueError, json.JSONDecodeError) as e:
                tracker.record_error(f"{ccy}: {e}")
            update_progress(i + 1, len(distinct), f"FX: fetched {ccy}")

        rows_updated = 0
        amt_expr = (
            f"CAST(REPLACE(REPLACE(REPLACE(TRIM({q_amt}), ',', ''), ' ', ''), "
            f"CHAR(160), '') AS REAL)"
        )

        for ccy, rate in rates.items():
            cur = conn.execute(
                f"""UPDATE {tbl}
                    SET {q_out} = printf('%.6f', {amt_expr} * ?)
                    WHERE UPPER(TRIM({q_cur})) = ?
                      AND {q_amt} IS NOT NULL AND TRIM({q_amt}) != ''
                      AND TRIM({q_amt}) GLOB '*[0-9]*'
                """,
                (rate, ccy),
            )
            rows_updated += cur.rowcount or 0
        conn.commit()

        clear_progress()
        return jsonify(
            {
                "tableKey": tk,
                "amountColumn": amt_col,
                "currencyColumn": cur_col,
                "targetCurrency": target,
                "outputColumn": out_col,
                "ratesUsed": rates,
                "rowsUpdated": rows_updated,
                "cost": tracker.summary(),
            }
        )
    except ValueError as ve:
        clear_progress()
        return jsonify({"error": str(ve)}), 400
    except Exception as exc:
        clear_progress()
        return jsonify({"error": str(exc)}), 500
