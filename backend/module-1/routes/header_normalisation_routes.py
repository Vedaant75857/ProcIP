"""Header normalisation routes: per-table schema mapping + procurement mapping."""

from __future__ import annotations

import importlib.util
import os
import sys

from flask import Blueprint, jsonify, request

from shared.db import get_session_db
from routes.summary_routes import execute_operation_kernel


def _load_mod(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


_hn_dir = os.path.join(os.path.dirname(__file__), "..", "header-normalisation")

if _hn_dir not in sys.path:
    sys.path.insert(0, _hn_dir)

_hn_service = _load_mod("hn_service", os.path.join(_hn_dir, "service.py"))

get_table_preview = _hn_service.get_table_preview

header_normalisation_bp = Blueprint("header_normalisation_bp", __name__)

CONCURRENCY = 3


# ---------------------------------------------------------------------------
# Per-table header normalisation (new step between Inventory and Append)
# ---------------------------------------------------------------------------

@header_normalisation_bp.route("/header-norm-run", methods=["POST"])
def header_norm_run():
    try:
        body = request.get_json(force=True, silent=True) or {}
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="header_norm_run",
            api_key=body.get("apiKey"),
            input_data={},
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        return jsonify(payload.get("result") or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@header_normalisation_bp.route("/header-norm-apply", methods=["POST"])
def header_norm_apply():
    try:
        body = request.get_json(force=True, silent=True) or {}
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="header_norm_apply",
            api_key=body.get("apiKey"),
            input_data={"decisions": body.get("decisions")},
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        return jsonify(payload.get("result") or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@header_normalisation_bp.route("/header-norm-preview", methods=["POST"])
def header_norm_preview():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        table_key = body.get("tableKey")
        limit = body.get("limit", 100)
        if not session_id or not table_key:
            return jsonify({"error": "Missing sessionId or tableKey"}), 400
        conn = get_session_db(session_id)
        result = get_table_preview(conn, table_key, int(limit))
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Procurement mapping on final_merged (existing, unchanged)
# ---------------------------------------------------------------------------


@header_normalisation_bp.route("/procurement-mapping", methods=["POST"])
def procurement_mapping():
    try:
        body = request.get_json(force=True)
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="procurement_mapping",
            api_key=body.get("apiKey"),
            input_data={},
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        return jsonify(payload.get("result") or {})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
