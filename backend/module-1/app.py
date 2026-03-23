"""Module 1 — Data Stitching API (Flask, port 3001)."""

import os
import sys
import threading
import time
import uuid

# Ensure backend/ is on sys.path so `shared.*` imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))

from flask import Flask, g, request
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider

from shared.db import cleanup_stale_sessions
from shared.utils import json_default


class AppJSONProvider(DefaultJSONProvider):
    def default(self, o):  # type: ignore[override]
        return json_default(o)


def create_app() -> Flask:
    app = Flask(__name__)
    app.json = AppJSONProvider(app)
    CORS(app)
    app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024  # 300 MB

    @app.before_request
    def _start_request_timer():
        g.request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]
        g._start_ts = time.perf_counter()

    @app.after_request
    def _log_request(resp):
        try:
            elapsed_ms = (time.perf_counter() - float(getattr(g, "_start_ts", time.perf_counter()))) * 1000
            path = request.path
            method = request.method
            status = resp.status_code
            rid = getattr(g, "request_id", "")
            print(f"[Module-1] {method} {path} -> {status} in {elapsed_ms:.1f}ms (rid={rid})")
            resp.headers["X-Request-Id"] = rid
            resp.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
        except Exception:
            pass
        return resp

    from routes.data_loading_routes import data_loading_bp
    from routes.inventory_routes import inventory_bp
    from routes.appending_routes import appending_bp
    from routes.header_normalisation_routes import header_normalisation_bp
    from routes.merging_routes import merging_bp
    from routes.summary_routes import summary_bp

    app.register_blueprint(data_loading_bp, url_prefix="/api")
    app.register_blueprint(inventory_bp, url_prefix="/api")
    app.register_blueprint(appending_bp, url_prefix="/api")
    app.register_blueprint(header_normalisation_bp, url_prefix="/api")
    app.register_blueprint(merging_bp, url_prefix="/api")
    app.register_blueprint(summary_bp, url_prefix="/api")

    return app


def _session_cleanup_loop() -> None:
    import time
    while True:
        time.sleep(60 * 60)
        cleaned = cleanup_stale_sessions()
        if cleaned:
            print(f"Cleaned up {cleaned} stale session(s).")


app = create_app()

if __name__ == "__main__":
    t = threading.Thread(target=_session_cleanup_loop, daemon=True)
    t.start()

    port = int(os.environ.get("NODE_PORT", "3001"))
    print(f"[Module-1] Data Stitching API running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
