"""
Public claim flow: static venue QR → phone + claim code → bind ticket, return guest URL.
No auth; rate-limited by IP.
"""
from datetime import datetime, timedelta
from collections import defaultdict
from flask import Blueprint, jsonify, request, abort

from app.extensions import db
from app.models import Venue, Ticket

bp = Blueprint("claim", __name__)

# Simple in-memory rate limit: IP -> list of timestamps (last N attempts)
_RATE_WINDOW = timedelta(minutes=5)
_RATE_MAX_ATTEMPTS = 15
_attempts: dict[str, list[datetime]] = defaultdict(list)


def _rate_limit():
    ip = request.remote_addr or "unknown"
    now = datetime.utcnow()
    cutoff = now - _RATE_WINDOW
    _attempts[ip] = [t for t in _attempts[ip] if t > cutoff]
    if len(_attempts[ip]) >= _RATE_MAX_ATTEMPTS:
        abort(429)
    _attempts[ip].append(now)


@bp.post("/v/<venue_slug>/claim/start")
def claim_start(venue_slug: str):
    """Optional: store phone for next step. For now just accept and return ok."""
    _rate_limit()
    venue = Venue.query.filter_by(slug=venue_slug).first()
    if not venue:
        abort(404, "venue not found")
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    if not phone:
        abort(400, "phone is required")
    return jsonify({"ok": True}), 200


@bp.post("/v/<venue_slug>/claim/confirm")
def claim_confirm(venue_slug: str):
    """
    Body: { phone, claim_code }.
    Find ticket by venue + claim_code, validate not expired, bind phone, return guest_url.
    """
    _rate_limit()
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    claim_code = (data.get("claim_code") or "").strip()
    if not phone or not claim_code:
        abort(400, "phone and claim_code are required")

    venue = Venue.query.filter_by(slug=venue_slug).first()
    if not venue:
        abort(404, "venue not found")

    ticket = (
        Ticket.query.filter_by(venue_id=venue.id, claim_code=claim_code)
        .order_by(Ticket.id.desc())
        .first()
    )
    now = datetime.utcnow()
    if not ticket:
        return jsonify({"ok": False, "error": "invalid_code", "message": "Invalid or expired code. Please try again."}), 400
    if ticket.claim_code_expires_at and now > ticket.claim_code_expires_at:
        return jsonify({"ok": False, "error": "expired", "message": "Code expired. Ask the valet for a new code."}), 400
    if ticket.claimed_at and ticket.claimed_phone != phone:
        return jsonify({"ok": False, "error": "already_claimed", "message": "This ticket was already claimed by another number."}), 400

    ticket.claimed_phone = phone
    ticket.claimed_at = now
    db.session.commit()

    # Frontend base URL: client will build guest_url; we can return path only or full URL if we had config
    guest_path = f"/t/{ticket.token}"
    masked_vehicle = None
    if ticket.car_number and len(ticket.car_number) >= 4:
        masked_vehicle = f"••••{ticket.car_number[-4:]}"

    return jsonify({
        "ok": True,
        "ticket_token": ticket.token,
        "guest_path": guest_path,
        "masked_vehicle": masked_vehicle,
    }), 200
