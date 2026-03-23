"""Inventory routes: clean-table (SQL transforms on session tables)."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from shared.db import get_session_db
from inventory.service import clean_table_sql

inventory_bp = Blueprint("inventory_bp", __name__)


@inventory_bp.route("/clean-table", methods=["POST"])
def clean_table():
    try:
        body = request.get_json(force=True)
        session_id = body.get("sessionId")
        table_key = body.get("tableKey")
        config = body.get("config")
        if not session_id or not table_key or not config:
            return jsonify({"error": "Missing required fields."}), 400

        conn = get_session_db(session_id)
        result = clean_table_sql(conn, table_key, config)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "An error occurred during cleaning."}), 500
