"""Merge API — setup, execute, match rate, CSV download, compatibility, normalize export."""

from __future__ import annotations

import os

from flask import Blueprint, Response, jsonify, request, stream_with_context

from merging.merge_executor import build_group_preview, generate_csv_stream
from merging.service import (
    compute_match_rate_for_keys,
    export_to_normalize,
    run_merge_compatibility,
    run_merge_compatibility_main_to_dims,
)
from routes.summary_routes import execute_operation_kernel

from shared.db import (
    column_stats,
    get_session_db,
    lookup_sql_name,
    read_table,
    table_exists,
    table_row_count,
)

merging_bp = Blueprint("merging_bp", __name__)

_INLINE_CSV_MAX_BYTES = int(os.getenv("MERGE_INLINE_CSV_MAX_BYTES", str(20 * 1024 * 1024)))


def _build_inline_csv(conn, table_name: str) -> tuple[str | None, bool]:
    total = 0
    chunks: list[str] = []
    for chunk in generate_csv_stream(conn, table_name):
        b = len(chunk.encode("utf-8"))
        if total + b > _INLINE_CSV_MAX_BYTES:
            return None, True
        chunks.append(chunk)
        total += b
    return "".join(chunks), False


@merging_bp.route("/merge-setup", methods=["POST"])
def merge_setup_route():
    try:
        body = request.get_json(force=True) or {}
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="merge_setup",
            api_key=body.get("apiKey"),
            input_data={
                "mainGroupId": body.get("mainGroupId"),
                "dimensionGroupIds": body.get("dimensionGroupIds"),
            },
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status
        return jsonify(payload.get("result") or {})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge-execute", methods=["POST"])
def merge_execute_route():
    try:
        body = request.get_json(force=True) or {}
        payload, status = execute_operation_kernel(
            session_id=body.get("sessionId"),
            operation="merge_execute",
            api_key=body.get("apiKey"),
            input_data={
                "mainGroupId": body.get("mainGroupId"),
                "mergePlan": body.get("mergePlan"),
                "mergeKeys": body.get("mergeKeys"),
                "dimColumnsToAdd": body.get("dimColumnsToAdd"),
            },
            options={"mode": "pipeline", "autoPrepare": True, "persist": True},
            request_id=request.headers.get("X-Request-Id"),
        )
        if status != 200:
            return jsonify({"error": payload.get("error"), "missing_requirements": payload.get("missing_requirements")}), status

        result = payload.get("result") or {}
        session_id = payload.get("sessionId")
        conn = get_session_db(str(session_id))
        final_table = str(result.get("final_table") or "final_merged")
        final_shape = result.get("final_shape") or {}
        main_gid = body.get("mainGroupId") or (payload.get("statePatch") or {}).get("mainGroupId")
        fact_sql = lookup_sql_name(conn, str(main_gid)) if main_gid else None
        fact_rows_before = table_row_count(conn, fact_sql) if fact_sql else int(final_shape.get("rows") or 0)
        final_column_stats = []
        for row in column_stats(conn, final_table):
            final_column_stats.append({**row, "source": "fact"})

        report = {
            "merge_exec": result.get("merge_exec", []),
            "final_shape": final_shape,
            "fact_rows_before_merge": fact_rows_before,
            "final_column_stats": final_column_stats,
        }
        preview = read_table(conn, final_table, 50)
        inline_csv, csv_truncated = _build_inline_csv(conn, final_table)

        payload = {
            **result,
            "report": report,
            "preview": preview,
            "csv": inline_csv,
            "csvTruncated": csv_truncated,
        }
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge-match-rate", methods=["POST"])
def merge_match_rate_route():
    try:
        body = request.get_json(force=True) or {}
        session_id = body.get("sessionId")
        main_gid = body.get("mainGroupId")
        dim_gid = body.get("dimensionGroupId")
        fact_keys = body.get("factKeys")
        dim_keys = body.get("dimKeys")
        if not session_id or not main_gid or not dim_gid:
            return jsonify({"error": "Missing sessionId, mainGroupId, or dimensionGroupId."}), 400
        if not fact_keys or not dim_keys or len(fact_keys) != len(dim_keys):
            return jsonify({"error": "factKeys and dimKeys must be non-empty and equal length."}), 400
        if any(not k for k in fact_keys) or any(not k for k in dim_keys):
            return jsonify({"error": "All keys must be non-empty."}), 400
        conn = get_session_db(session_id)
        fact_sql = lookup_sql_name(conn, main_gid)
        dim_sql = lookup_sql_name(conn, dim_gid)
        if not fact_sql or not dim_sql:
            return jsonify({"error": "Invalid group ID(s)."}), 400
        out = compute_match_rate_for_keys(conn, fact_sql, dim_sql, list(fact_keys), list(dim_keys))
        return jsonify(out)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/download-csv", methods=["GET"])
def download_csv_route():
    try:
        session_id = request.args.get("sessionId")
        if not session_id:
            return jsonify({"error": "sessionId query parameter is required."}), 400
        conn = get_session_db(session_id)
        if not table_exists(conn, "final_merged"):
            return jsonify({"error": "No merged data found."}), 404

        headers = {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="final_flat.csv"',
        }
        return Response(
            stream_with_context(generate_csv_stream(conn, "final_merged")),
            headers=headers,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge-compatibility", methods=["POST"])
def merge_compatibility_route():
    try:
        body = request.get_json(force=True) or {}
        session_id = body.get("sessionId")
        api_key = body.get("apiKey")
        if not session_id:
            return jsonify({"error": "sessionId is required."}), 400
        conn = get_session_db(session_id)

        groups = body.get("groups")
        main_gid = body.get("mainGroupId")
        dim_gids = body.get("dimensionGroupIds")

        if groups and len(groups) >= 2:
            result = run_merge_compatibility(conn, session_id, list(groups), api_key)
        elif main_gid and dim_gids:
            result = run_merge_compatibility_main_to_dims(
                conn, session_id, str(main_gid), list(dim_gids), api_key
            )
        else:
            return jsonify({
                "error": "Provide either groups (2+) or mainGroupId with dimensionGroupIds.",
            }), 400

        if result.get("error"):
            return jsonify(result), 400
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/group-preview", methods=["POST"])
def group_preview_route():
    try:
        body = request.get_json(force=True) or {}
        session_id = body.get("sessionId")
        group_ids = body.get("groupIds") or body.get("group_ids")
        if not session_id or not group_ids:
            return jsonify({"error": "sessionId and groupIds are required."}), 400
        conn = get_session_db(session_id)
        previews = build_group_preview(conn, [str(g) for g in group_ids])
        return jsonify({"previews": previews})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/export-to-normalize", methods=["POST"])
def export_to_normalize_route():
    try:
        body = request.get_json(force=True) or {}
        session_id = body.get("sessionId")
        if not session_id:
            return jsonify({"error": "sessionId is required."}), 400
        table_name = body.get("tableName") or "final_merged"
        conn = get_session_db(session_id)
        result = export_to_normalize(conn, session_id, table_name)
        if not result.get("success"):
            return jsonify(result), 404
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
