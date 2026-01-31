from flask import Blueprint, jsonify
from sqlalchemy import text
from app.extensions import db

bp = Blueprint("health", __name__)


@bp.get("/")
def root():
    return jsonify(
        message="CurbKey backend is running",
        health="/healthz",
    )


@bp.get("/healthz")
def healthz():
    try:
        db.session.execute(text("SELECT 1"))
        return jsonify(status="ok", db="ok")
    except Exception as e:
        return jsonify(status="degraded", db="error", error=str(e)), 500
