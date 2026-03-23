import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))

from flask import Flask, jsonify
from flask_cors import CORS


def create_app():
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024

    from routes.normalisation_routes import normalisation_bp
    from routes.country_normalisation_routes import country_normalisation_bp
    from routes.fx_rates_normalisation_routes import fx_rates_normalisation_bp
    from routes.supplier_normalisation_routes import supplier_normalisation_bp
    from routes.payment_terms_normalisation_routes import payment_terms_normalisation_bp

    app.register_blueprint(normalisation_bp, url_prefix="/api")
    app.register_blueprint(country_normalisation_bp, url_prefix="/api")
    app.register_blueprint(fx_rates_normalisation_bp, url_prefix="/api")
    app.register_blueprint(supplier_normalisation_bp, url_prefix="/api")
    app.register_blueprint(payment_terms_normalisation_bp, url_prefix="/api")

    @app.route("/api/status", methods=["GET"])
    def health_check():
        return jsonify({"status": "ok", "service": "normalize-ai"})

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_PORT", "5000"))
    print(f"[Module-2] Normalize-AI API running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
