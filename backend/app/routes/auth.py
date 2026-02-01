from flask import Blueprint, jsonify, request, abort, g
from flask_jwt_extended import create_access_token
from werkzeug.security import generate_password_hash, check_password_hash

from app.extensions import db
from app.models import User, Venue, Role
from app.auth import require_role, get_current_user

bp = Blueprint("auth", __name__)


@bp.post("/auth/seed")
def seed():
    if User.query.count() > 0:
        return jsonify({"message": "already seeded"}), 200

    data = request.get_json(silent=True) or {}
    venue_name = (data.get("venue_name") or "Default Venue").strip()
    email = (data.get("email") or "admin@curbkey.com").strip().lower()
    password = data.get("password") or "admin123"

    v = Venue(name=venue_name, slug="demo-venue")
    db.session.add(v)
    db.session.flush()

    u = User(
        email=email,
        password_hash=generate_password_hash(password),
        role=Role.MANAGER,
        venue_id=v.id,
    )
    db.session.add(u)
    db.session.commit()

    return jsonify({
        "message": "seeded",
        "venue_id": v.id,
        "email": email,
        "password": password,
    }), 201


@bp.post("/auth/login")
def login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        abort(400, "email and password are required")

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        abort(401, "invalid credentials")

    token = create_access_token(identity=str(user.id))
    return jsonify({
        "access_token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "role": user.role,
            "venue_id": user.venue_id,
        },
    })


@bp.get("/me")
@require_role(Role.VALET, Role.MANAGER)
def me():
    user = get_current_user()
    return jsonify({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "venue_id": user.venue_id,
    })


@bp.post("/auth/register")
@require_role(Role.MANAGER)
def register():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    role = (data.get("role") or "VALET").strip().upper()
    venue_id = data.get("venue_id") or g.user.venue_id

    if not email or not password:
        abort(400, "email and password are required")
    if role not in {"VALET", "MANAGER"}:
        abort(400, "invalid role")

    if User.query.filter_by(email=email).first():
        abort(409, "email already exists")

    user = User(
        email=email,
        password_hash=generate_password_hash(password),
        role=Role[role],
        venue_id=venue_id,
    )
    db.session.add(user)
    db.session.commit()

    return jsonify({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "venue_id": user.venue_id,
    }), 201
