"""Guided Merge API — recommend base, common columns, simulate, execute, validate, finalize, download."""

from __future__ import annotations

import csv
import io
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context

from shared.db import (
    get_session_db,
    lookup_sql_name,
    read_table,
    read_table_columns,
    table_exists,
    table_row_count,
    quote_id,
)

from merging.guided_merge_service import (
    classify_all_columns,
    classify_columns,
    execute_merge,
    finalize_merge,
    find_common_columns,
    generate_validation_report,
    recommend_base_file,
    simulate_join,
    skip_merge,
)

merging_bp = Blueprint("merging_bp", __name__)


@merging_bp.route("/merge/recommend-base", methods=["POST"])
def recommend_base():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        api_key = body.get("apiKey")
        if not session_id:
            return jsonify({"error": "Missing sessionId"}), 400
        conn = get_session_db(session_id)
        result = recommend_base_file(conn, session_id, api_key)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/common-columns", methods=["POST"])
def common_columns():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        base_group_id = body.get("baseGroupId")
        source_group_id = body.get("sourceGroupId")
        api_key = body.get("apiKey")
        include_preview = body.get("includePreview", False)
        if not session_id or not base_group_id or not source_group_id:
            return jsonify({"error": "Missing sessionId, baseGroupId, or sourceGroupId"}), 400

        conn = get_session_db(session_id)
        base_sql = lookup_sql_name(conn, base_group_id)
        source_sql = lookup_sql_name(conn, source_group_id)
        if not base_sql or not source_sql:
            return jsonify({"error": "Invalid group ID(s)"}), 400

        # Column lists + instant classification (no DB, runs in <1ms)
        base_cols = read_table_columns(conn, base_sql)
        source_cols = read_table_columns(conn, source_sql)
        base_col_classes = classify_all_columns(base_cols)
        source_col_classes = classify_all_columns(source_cols)

        common = find_common_columns(conn, base_sql, source_sql)
        classified = classify_columns(conn, session_id, api_key, common, base_sql_name=base_sql)

        result: dict[str, Any] = {
            "common_columns": classified,
            "base_columns": base_cols,
            "source_columns": source_cols,
            "base_column_classes": base_col_classes,
            "source_column_classes": source_col_classes,
            "base_group_id": base_group_id,
            "source_group_id": source_group_id,
        }
        if include_preview:
            base_rows = read_table(conn, base_sql, 50)
            source_rows = read_table(conn, source_sql, 50)
            result["base_preview"] = {"columns": base_cols, "rows": base_rows, "total_rows": table_row_count(conn, base_sql)}
            result["source_preview"] = {"columns": source_cols, "rows": source_rows, "total_rows": table_row_count(conn, source_sql)}
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/simulate", methods=["POST"])
def simulate():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        base_group_id = body.get("baseGroupId")
        source_group_id = body.get("sourceGroupId")
        key_pairs = body.get("keyPairs", [])
        if not session_id or not base_group_id or not source_group_id:
            return jsonify({"error": "Missing required fields"}), 400
        if not key_pairs:
            return jsonify({"error": "At least one key pair required"}), 400

        conn = get_session_db(session_id)
        base_sql = lookup_sql_name(conn, base_group_id)
        source_sql = lookup_sql_name(conn, source_group_id)
        if not base_sql or not source_sql:
            return jsonify({"error": "Invalid group ID(s)"}), 400

        result = simulate_join(conn, base_sql, source_sql, key_pairs)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/execute", methods=["POST"])
def execute():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        base_group_id = body.get("baseGroupId")
        source_group_id = body.get("sourceGroupId")
        key_pairs = body.get("keyPairs", [])
        pull_columns = body.get("pullColumns", [])
        if not session_id or not base_group_id or not source_group_id:
            return jsonify({"error": "Missing required fields"}), 400

        conn = get_session_db(session_id)
        base_sql = lookup_sql_name(conn, base_group_id)
        source_sql = lookup_sql_name(conn, source_group_id)
        if not base_sql or not source_sql:
            return jsonify({"error": "Invalid group ID(s)"}), 400

        merge_log = execute_merge(
            conn, session_id, base_sql, source_sql, key_pairs, pull_columns, source_group_id
        )
        report = generate_validation_report(
            conn, base_sql, source_sql, merge_log["result_table"], merge_log
        )

        return jsonify({
            "merge_log": merge_log,
            "validation_report": report,
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/finalize", methods=["POST"])
def finalize():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        approved_merges = body.get("approvedMerges", [])
        if not session_id:
            return jsonify({"error": "Missing sessionId"}), 400
        if not approved_merges:
            return jsonify({"error": "No approved merges provided"}), 400

        conn = get_session_db(session_id)
        result = finalize_merge(conn, session_id, approved_merges)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/skip", methods=["POST"])
def skip():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        base_group_id = body.get("baseGroupId")
        if not session_id or not base_group_id:
            return jsonify({"error": "Missing sessionId or baseGroupId"}), 400
        conn = get_session_db(session_id)
        result = skip_merge(conn, session_id, base_group_id)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/download-csv", methods=["GET"])
def download_csv():
    try:
        session_id = request.args.get("sessionId")
        if not session_id:
            return jsonify({"error": "sessionId query parameter is required"}), 400
        conn = get_session_db(session_id)
        if not table_exists(conn, "final_merged"):
            return jsonify({"error": "No merged data found"}), 404

        def _generate():
            columns = read_table_columns(conn, "final_merged")
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(columns)
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate()

            cursor = conn.execute(f"SELECT * FROM {quote_id('final_merged')}")
            while True:
                rows = cursor.fetchmany(2000)
                if not rows:
                    break
                for row in rows:
                    writer.writerow([row[c] for c in columns])
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()

        return Response(
            stream_with_context(_generate()),
            headers={
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="final_merged.csv"',
            },
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/merge/table-preview", methods=["POST"])
def table_preview():
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        group_id = body.get("groupId")
        limit = min(int(body.get("limit", 50)), 200)
        if not session_id or not group_id:
            return jsonify({"error": "Missing sessionId or groupId"}), 400

        conn = get_session_db(session_id)
        sql_name = lookup_sql_name(conn, group_id)
        if not sql_name or not table_exists(conn, sql_name):
            return jsonify({"error": f"Table not found for group {group_id}"}), 404

        columns = read_table_columns(conn, sql_name)
        rows = read_table(conn, sql_name, limit)
        total = table_row_count(conn, sql_name)

        return jsonify({
            "group_id": group_id,
            "columns": columns,
            "rows": rows,
            "total_rows": total,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@merging_bp.route("/group-preview", methods=["POST"])
def group_preview_route():
    """Backward-compatible group preview endpoint."""
    try:
        body = request.get_json(force=True, silent=True) or {}
        session_id = body.get("sessionId")
        group_ids = body.get("groupIds") or body.get("group_ids") or []
        if not session_id or not group_ids:
            return jsonify({"error": "sessionId and groupIds are required"}), 400
        conn = get_session_db(session_id)
        result: dict[str, Any] = {}
        for gid in group_ids:
            gid = str(gid)
            sql_name = lookup_sql_name(conn, gid)
            if not sql_name:
                sql_name = gid if table_exists(conn, gid) else None
            if not sql_name or not table_exists(conn, sql_name):
                continue
            columns = read_table_columns(conn, sql_name)
            rows = read_table(conn, sql_name, 50)
            total = table_row_count(conn, sql_name)
            result[gid] = {"columns": columns, "rows": rows, "total_rows": total}
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
