from flask import Flask, jsonify
from flask_cors import CORS
from app.config import Config
from app.extensions import db, migrate, jwt
from app import models  # noqa: F401

from app.routes.health import bp as health_bp
from app.routes.core import bp as core_bp
from app.routes.sse import bp as sse_bp
from app.routes.auth import bp as auth_bp
from app.routes.notifs import bp as notifs_bp
from app.routes.scheduler import bp as scheduler_bp
from app.routes.claim import bp as claim_bp
from app.cli import register_cli


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # CORS: set CORS_ORIGINS in production; dev allows * (we’ll lock down later)
    origins = app.config.get("CORS_ORIGINS")
    CORS(app, origins=origins if isinstance(origins, list) else "*")

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    @app.errorhandler(404)
    def not_found(e):
        message = getattr(e, "description", str(e)) or "Not found"
        return jsonify({"error": "not_found", "message": message}), 404

    @app.errorhandler(500)
    def server_error(e):
        message = getattr(e, "description", str(e)) or "Internal server error"
        return jsonify({"error": "server_error", "message": message}), 500

    app.register_blueprint(health_bp)
    app.register_blueprint(core_bp)
    app.register_blueprint(sse_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(notifs_bp)
    app.register_blueprint(scheduler_bp)
    app.register_blueprint(claim_bp)
    register_cli(app)

    return app
