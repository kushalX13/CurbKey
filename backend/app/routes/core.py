import re
import random
from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, request, abort, g
from sqlalchemy import func, case
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import (
    Venue, Exit, Zone, Ticket, Request as CarRequest, StatusEvent,
    RequestStatus, Role, User, NotificationSubscription, NotificationOutbox, Tip,
)
from app.auth import require_role, get_current_user
from app.routes.notifs import queue_and_send, _render_message

bp = Blueprint("core", __name__)

CLAIM_CODE_EXPIRY_HOURS = 6


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "venue"


def _generate_claim_code(venue_id: int) -> str:
    for _ in range(20):
        code = "".join(random.choices("0123456789", k=6))
        if not Ticket.query.filter_by(venue_id=venue_id, claim_code=code).first():
            return code
    abort(500, "could not generate unique claim code")

ALLOWED_TRANSITIONS = {
    "SCHEDULED": {"REQUESTED", "CANCELED"},
    "REQUESTED": {"ASSIGNED", "RETRIEVING"},
    "ASSIGNED": {"RETRIEVING"},
    "RETRIEVING": {"READY"},
    "READY": {"PICKED_UP"},
    "PICKED_UP": {"CLOSED"},
    "CLOSED": set(),
    "CANCELED": set(),
}

ACTIVE_STATUSES = ["SCHEDULED", "REQUESTED", "ASSIGNED", "RETRIEVING", "READY"]

# Reschedule / cancel rules (ops polish)
RESCHEDULE_MIN_SECONDS_BEFORE = 30   # no reschedule within this many seconds of scheduled_for
RESCHEDULE_MAX_PER_REQUEST = 3       # max reschedule count per SCHEDULED request
RESCHEDULE_COOLDOWN_SECONDS = 10     # min seconds between reschedule/cancel changes
CANCEL_MIN_SECONDS_BEFORE = 10      # no cancel within this many seconds of scheduled_for (use 30 to match reschedule)

def _json(model):
    # serialize to JSON for API responses
    if model is None:
        return None
    if isinstance(model, Venue):
        return {"id": model.id, "name": model.name, "slug": model.slug}
    if isinstance(model, Exit):
        return {"id": model.id, "venue_id": model.venue_id, "name": model.name, "code": model.code, "is_active": model.is_active}
    if isinstance(model, Zone):
        return {
            "id": model.id,
            "venue_id": model.venue_id,
            "name": model.name,
            "default_exit_id": model.default_exit_id,
            "default_exit": _json(model.default_exit),
        }
    if isinstance(model, Ticket):
        return {
            "id": model.id,
            "venue_id": model.venue_id,
            "token": model.token,
            "car_number": model.car_number,
            "vehicle_description": model.vehicle_description,
            "claim_code": model.claim_code,
            "claimed_phone": model.claimed_phone,
            "claimed_at": model.claimed_at.isoformat() if model.claimed_at else None,
            "created_at": model.created_at.isoformat(),
        }
    if isinstance(model, CarRequest):
        ticket = model.ticket
        claimed_phone_masked = None
        if ticket and ticket.claimed_phone:
            p = ticket.claimed_phone
            if len(p) >= 4:
                claimed_phone_masked = "***-***-" + p[-4:]
            else:
                claimed_phone_masked = "***"
        out = {
            "id": model.id,
            "ticket_id": model.ticket_id,
            "ticket_token": ticket.token if ticket else None,
            "car_number": ticket.car_number if ticket else None,
            "vehicle_description": ticket.vehicle_description if ticket else None,
            "claimed_at": ticket.claimed_at.isoformat() if ticket and ticket.claimed_at else None,
            "claimed_phone_masked": claimed_phone_masked,
            "exit_id": model.exit_id,
            "exit": _json(model.exit),
            "status": model.status,
            "scheduled_for": (model.scheduled_for.isoformat() + "Z") if model.scheduled_for else None,
            "assigned_to": model.assigned_to,
            "assigned_at": model.assigned_at.isoformat() if model.assigned_at else None,
            "zone_id": model.zone_id,
            "zone": {"id": model.zone.id, "name": model.zone.name} if model.zone else None,
            "created_at": model.created_at.isoformat(),
            "updated_at": model.updated_at.isoformat(),
            "delivered_by_user_id": model.delivered_by_user_id,
        }
        out["tip_eligible"] = (
            str(model.status) in ("CLOSED", "PICKED_UP") and model.delivered_by_user_id is not None
        )
        return out
    if isinstance(model, StatusEvent):
        return {
            "id": int(model.id),
            "ticket_id": model.ticket_id,
            "request_id": model.request_id,
            "from_status": model.from_status,
            "to_status": model.to_status,
            "note": model.note,
            "created_at": model.created_at.isoformat(),
        }
    return {"id": getattr(model, "id", None)}


def _exit_stats_for_venue(venue_id: int, window_hours: int = 24, max_seconds: int = 1800):
    since = datetime.utcnow() - timedelta(hours=window_hours)

    requested_ts = func.min(
        case((StatusEvent.to_status == "REQUESTED", StatusEvent.created_at), else_=None)
    )
    ready_ts = func.min(
        case((StatusEvent.to_status == "READY", StatusEvent.created_at), else_=None)
    )

    per_req = (
        db.session.query(
            StatusEvent.request_id.label("rid"),
            CarRequest.exit_id.label("exit_id"),
            requested_ts.label("requested_at"),
            ready_ts.label("ready_at"),
        )
        .join(Ticket, Ticket.id == StatusEvent.ticket_id)
        .join(CarRequest, CarRequest.id == StatusEvent.request_id)
        .filter(Ticket.venue_id == venue_id)
        .filter(StatusEvent.created_at >= since)
        .group_by(StatusEvent.request_id, CarRequest.exit_id)
        .subquery()
    )

    duration = func.extract("epoch", per_req.c.ready_at - per_req.c.requested_at)

    eta_rows = (
        db.session.query(
            per_req.c.exit_id,
            func.count().label("n"),
            func.avg(duration).label("avg_seconds"),
        )
        .filter(per_req.c.requested_at.isnot(None), per_req.c.ready_at.isnot(None))
        .filter(duration <= max_seconds)
        .group_by(per_req.c.exit_id)
        .all()
    )

    eta_by_exit = {
        int(r.exit_id): {"n": int(r.n), "avg_seconds": float(r.avg_seconds)}
        for r in eta_rows
    }

    q_rows = (
        db.session.query(CarRequest.exit_id, func.count(CarRequest.id))
        .join(Ticket, Ticket.id == CarRequest.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .filter(CarRequest.status.in_(ACTIVE_STATUSES))
        .group_by(CarRequest.exit_id)
        .all()
    )
    queue_by_exit = {int(eid): int(cnt) for eid, cnt in q_rows}

    exits = Exit.query.filter_by(venue_id=venue_id, is_active=True).order_by(Exit.id.asc()).all()

    out = []
    for ex in exits:
        eta = eta_by_exit.get(ex.id, {"n": 0, "avg_seconds": 0.0})
        out.append({
            "exit_id": ex.id,
            "code": ex.code,
            "name": ex.name,
            "queue": queue_by_exit.get(ex.id, 0),
            "eta_seconds": eta["avg_seconds"],
            "eta_samples": eta["n"],
        })
    return out


@bp.post("/api/venues")
@require_role(Role.MANAGER)
def create_venue():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        abort(400, "name is required")
    slug = (data.get("slug") or _slugify(name)).strip() or _slugify(name)
    if Venue.query.filter_by(slug=slug).first():
        abort(400, f"venue slug already exists: {slug}")
    v = Venue(name=name, slug=slug)
    db.session.add(v)
    db.session.commit()
    return jsonify(_json(v)), 201


@bp.post("/api/venues/<int:venue_id>/exits")
@require_role(Role.MANAGER)
def create_exit(venue_id: int):
    Venue.query.get_or_404(venue_id)
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    code = (data.get("code") or "").strip()
    if not name or not code:
        abort(400, "name and code are required")
    ex = Exit(venue_id=venue_id, name=name, code=code)
    db.session.add(ex)
    db.session.commit()
    return jsonify(_json(ex)), 201


@bp.post("/api/venues/<int:venue_id>/zones")
@require_role(Role.MANAGER)
def create_zone(venue_id: int):
    Venue.query.get_or_404(venue_id)
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    default_exit_id = data.get("default_exit_id")
    if not name or not default_exit_id:
        abort(400, "name and default_exit_id are required")

    default_exit = Exit.query.get_or_404(int(default_exit_id))
    if default_exit.venue_id != venue_id:
        abort(400, "default exit must belong to this venue")

    z = Zone(venue_id=venue_id, name=name, default_exit_id=default_exit.id)
    db.session.add(z)
    db.session.commit()
    return jsonify({"id": z.id, "venue_id": z.venue_id, "name": z.name, "default_exit_id": z.default_exit_id}), 201


@bp.get("/api/venues/<int:venue_id>/zones")
@require_role(Role.VALET, Role.MANAGER)
def list_zones(venue_id: int):
    zones = Zone.query.filter_by(venue_id=venue_id).order_by(Zone.id.asc()).all()
    return jsonify([{"id": z.id, "name": z.name, "default_exit_id": z.default_exit_id} for z in zones])


# Canonical exit code order for dropdown (A, B, C)
EXIT_CODE_ORDER = ("A", "B", "C")


@bp.get("/api/venues/<int:venue_id>/exits")
def list_exits(venue_id: int):
    exits = Exit.query.filter_by(venue_id=venue_id, is_active=True).order_by(Exit.id.asc()).all()
    # One exit per code (keep first by id), then return in order A, B, C
    by_code = {}
    for e in exits:
        if e.code not in by_code:
            by_code[e.code] = e
    ordered = [by_code[c] for c in EXIT_CODE_ORDER if c in by_code]
    return jsonify([_json(e) for e in ordered])


def _ensure_venue_has_abc_exits(venue_id: int) -> list:
    """
    Ensure this venue has exactly one active exit per code A, B, C.
    Deactivate duplicate exits (keep first by id), create missing B/C if needed.
    Returns list of active exit dicts {id, code, name} for this venue.
    """
    EXITS_SPEC = [
        ("A", "Main Gate"),
        ("B", "Side Exit"),
        ("C", "Patio"),
    ]
    code_to_keep_id = {}  # code -> id of the one we keep active
    for code, name in EXITS_SPEC:
        same_code = Exit.query.filter_by(venue_id=venue_id, code=code).order_by(Exit.id.asc()).all()
        if not same_code:
            ex = Exit(venue_id=venue_id, code=code, name=name)
            db.session.add(ex)
            db.session.flush()
            code_to_keep_id[code] = ex.id
        else:
            # keep first, deactivate rest
            code_to_keep_id[code] = same_code[0].id
            same_code[0].name = name
            same_code[0].is_active = True
            for ex in same_code[1:]:
                ex.is_active = False
            # point any zone that pointed at a deactivated exit to the kept one
            for z in Zone.query.filter_by(venue_id=venue_id).all():
                if z.default_exit_id in {e.id for e in same_code[1:]}:
                    z.default_exit_id = same_code[0].id
    return [
        {"id": code_to_keep_id[c], "code": c, "name": n}
        for c, n in EXITS_SPEC
    ]


@bp.post("/api/demo/seed")
@require_role(Role.MANAGER)
def seed_demo_venue():
    """
    Manager-only: idempotent demo setup. Ensures every venue has exactly
    Exits A/B/C (fixes duplicates, adds missing B/C). First venue gets
    Zones Bar/Patio/Main. Optional body: create_valet=true, valet_email=..., valet_password=...
    """
    data = request.get_json(silent=True) or {}

    # Ensure at least one venue exists
    v = Venue.query.order_by(Venue.id.asc()).first()
    if not v:
        v = Venue(name=data.get("venue_name") or "Demo Venue", slug="demo-venue")
        db.session.add(v)
        db.session.flush()
    # Ensure first venue has demo slug for static QR /v/demo-venue
    if v.slug != "demo-venue":
        v.slug = "demo-venue"
        db.session.flush()

    # Fix ALL venues: each gets exactly A, B, C (one active per code)
    for venue in Venue.query.order_by(Venue.id.asc()).all():
        _ensure_venue_has_abc_exits(venue.id)

    # Re-fetch first venue for zones and response
    v = Venue.query.order_by(Venue.id.asc()).first()
    code_to_id = {ex["code"]: ex["id"] for ex in _ensure_venue_has_abc_exits(v.id)}
    exits_created = [{"id": code_to_id[c], "code": c, "name": n} for c, n in [("A", "Main Gate"), ("B", "Side Exit"), ("C", "Patio")]]

    # Zones only on first venue: Bar->A, Patio->C, Main->A (get or create)
    zones_spec = [("Bar", "A"), ("Patio", "C"), ("Main", "A")]
    zones_created = []
    for zone_name, exit_code in zones_spec:
        z = Zone.query.filter_by(venue_id=v.id, name=zone_name).first()
        if not z:
            z = Zone(venue_id=v.id, name=zone_name, default_exit_id=code_to_id[exit_code])
            db.session.add(z)
            db.session.flush()
        else:
            z.default_exit_id = code_to_id[exit_code]
        zones_created.append({"id": z.id, "name": z.name, "default_exit_id": z.default_exit_id})

    valet_out = None
    if data.get("create_valet"):
        email = (data.get("valet_email") or "valet@demo.curbkey.com").strip().lower()
        password = data.get("valet_password") or "valet123"
        if User.query.filter_by(email=email).first():
            abort(400, f"valet user already exists: {email}")
        u = User(
            email=email,
            password_hash=generate_password_hash(password),
            role=Role.VALET,
            venue_id=v.id,
        )
        db.session.add(u)
        db.session.flush()
        valet_out = {"id": u.id, "email": u.email}

    db.session.commit()
    return jsonify({
        "venue_id": v.id,
        "exits": exits_created,
        "zones": zones_created,
        "valet": valet_out,
    }), 201


@bp.post("/api/demo/ticket")
@require_role(Role.MANAGER)
def create_demo_ticket():
    """Create a new ticket for demo; returns token and claim_code."""
    venue = Venue.query.order_by(Venue.id.asc()).first()
    if not venue:
        abort(400, "no venue found; run /auth/seed first")
    token = Ticket.new_token()
    claim_code = _generate_claim_code(venue.id)
    expires = datetime.utcnow() + timedelta(hours=CLAIM_CODE_EXPIRY_HOURS)
    t = Ticket(venue_id=venue.id, token=token, claim_code=claim_code, claim_code_expires_at=expires)
    db.session.add(t)
    db.session.commit()
    return jsonify({"token": t.token, "claim_code": claim_code}), 201


@bp.post("/api/demo/tickets")
@require_role(Role.MANAGER)
def create_demo_tickets():
    """Manager-only: create ticket(s) for a venue. Body: { venue_id?, count?: 1 } (count max 10). Returns single or { tickets, count }."""
    data = request.get_json(silent=True) or {}
    venue_id = data.get("venue_id")
    if venue_id is not None:
        venue = Venue.query.get(venue_id)
        if not venue:
            abort(404, "venue not found")
    else:
        venue = Venue.query.order_by(Venue.id.asc()).first()
        if not venue:
            abort(400, "no venue found; run /auth/seed or POST /api/demo/seed first")
    count = min(max(1, int(data.get("count") or 1)), 10)
    results = []
    for _ in range(count):
        token = Ticket.new_token()
        claim_code = _generate_claim_code(venue.id)
        expires = datetime.utcnow() + timedelta(hours=CLAIM_CODE_EXPIRY_HOURS)
        t = Ticket(venue_id=venue.id, token=token, claim_code=claim_code, claim_code_expires_at=expires)
        db.session.add(t)
        db.session.flush()
        results.append({"token": t.token, "guest_url": f"/t/{t.token}", "claim_code": claim_code, "venue_slug": venue.slug})
    db.session.commit()
    if count == 1:
        return jsonify(results[0]), 201
    return jsonify({"tickets": results, "count": count}), 201


@bp.post("/api/demo/reset")
@require_role(Role.MANAGER)
def reset_demo():
    """
    Manager-only: wipe tickets, requests, status_events, notification_subscriptions, outbox
    for a venue (or entire DB). Keeps venues, exits, zones, users.
    Body: { venue_id } (optional). If absent, wipes all tickets and related data.
    """
    data = request.get_json(silent=True) or {}
    venue_id = data.get("venue_id")

    if venue_id is not None:
        Venue.query.get_or_404(venue_id)
        ticket_ids = [r[0] for r in db.session.query(Ticket.id).filter(Ticket.venue_id == venue_id).all()]
    else:
        ticket_ids = [r[0] for r in db.session.query(Ticket.id).all()]

    if not ticket_ids:
        return jsonify({"ok": True, "deleted": {"tickets": 0, "requests": 0, "status_events": 0, "notification_subscriptions": 0, "outbox": 0, "tips": 0}}), 200

    # Child tables first (FK constraints). Tips reference requests, so delete tips before requests.
    request_ids = [r[0] for r in db.session.query(CarRequest.id).filter(CarRequest.ticket_id.in_(ticket_ids)).all()]
    n_tips = Tip.query.filter(Tip.request_id.in_(request_ids)).delete(synchronize_session=False) if request_ids else 0
    n_outbox = NotificationOutbox.query.filter(NotificationOutbox.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
    n_subs = NotificationSubscription.query.filter(NotificationSubscription.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
    n_events = StatusEvent.query.filter(StatusEvent.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
    n_requests = CarRequest.query.filter(CarRequest.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
    n_tickets = Ticket.query.filter(Ticket.id.in_(ticket_ids)).delete(synchronize_session=False)

    db.session.commit()
    return jsonify({
        "ok": True,
        "deleted": {
            "tickets": n_tickets,
            "requests": n_requests,
            "status_events": n_events,
            "notification_subscriptions": n_subs,
            "outbox": n_outbox,
            "tips": n_tips,
        },
    }), 200


@bp.post("/api/tickets")
def create_ticket():
    data = request.get_json(force=True)
    venue_id = data.get("venue_id")
    if not venue_id:
        abort(400, "venue_id is required")
    venue = Venue.query.get_or_404(int(venue_id))

    token = Ticket.new_token()
    claim_code = _generate_claim_code(venue.id)
    expires = datetime.utcnow() + timedelta(hours=CLAIM_CODE_EXPIRY_HOURS)
    t = Ticket(venue_id=int(venue_id), token=token, claim_code=claim_code, claim_code_expires_at=expires)
    db.session.add(t)
    db.session.commit()
    return jsonify({"ticket": _json(t), "guest_path": f"/t/{t.token}", "claim_code": claim_code, "venue_slug": venue.slug}), 201


@bp.post("/api/valet/tickets")
@require_role(Role.VALET)
def valet_create_ticket():
    """Valet: create ticket(s) when cars arrive. Body: { count?: 1 } (default 1, max 10). Returns single obj or list."""
    user = g.user
    if not user.venue_id:
        abort(403, "valet has no venue")
    venue = Venue.query.get_or_404(user.venue_id)
    data = request.get_json(silent=True) or {}
    count = min(max(1, int(data.get("count") or 1)), 10)
    results = []
    for _ in range(count):
        token = Ticket.new_token()
        claim_code = _generate_claim_code(venue.id)
        expires = datetime.utcnow() + timedelta(hours=CLAIM_CODE_EXPIRY_HOURS)
        t = Ticket(venue_id=venue.id, token=token, claim_code=claim_code, claim_code_expires_at=expires)
        db.session.add(t)
        db.session.flush()
        results.append({
            "ticket": _json(t),
            "guest_path": f"/t/{t.token}",
            "claim_code": claim_code,
            "venue_slug": venue.slug,
        })
    db.session.commit()
    if count == 1:
        return jsonify(results[0]), 201
    return jsonify({"tickets": results, "count": count}), 201


@bp.patch("/api/tickets/<int:ticket_id>/car-number")
@require_role(Role.VALET, Role.MANAGER)
def set_ticket_car_number(ticket_id: int):
    """Valet/manager: set car number (plate) and vehicle description (e.g. McLaren 720) on ticket."""
    t = Ticket.query.get_or_404(ticket_id)
    user = g.user
    if user.role == Role.VALET and t.venue_id != user.venue_id:
        abort(403, "ticket not in your venue")
    data = request.get_json(silent=True) or {}
    car_number = (data.get("car_number") or "").strip() or None
    vehicle_description = (data.get("vehicle_description") or "").strip() or None
    t.car_number = car_number
    t.vehicle_description = vehicle_description
    db.session.commit()
    return jsonify({"ticket": _json(t)}), 200


@bp.get("/api/received-tickets")
@require_role(Role.VALET, Role.MANAGER)
def list_received_tickets():
    """
    List tickets that have been claimed (customer used OTP) but not yet closed.
    Valet/manager can enter car details here when the car is received.
    Query: venue_id (required for MANAGER; VALET uses their venue).
    """
    venue_id = request.args.get("venue_id", type=int)
    user = g.user
    if user.role == Role.VALET:
        venue_id = user.venue_id
    if not venue_id:
        abort(400, "venue_id is required")
    q = (
        Ticket.query.filter(Ticket.venue_id == venue_id)
        .filter(Ticket.claimed_at.isnot(None))
        .filter(Ticket.closed_at.is_(None))
        .order_by(Ticket.claimed_at.desc())
        .limit(50)
    )
    tickets = q.all()
    out = []
    for t in tickets:
        obj = _json(t)
        claimed_phone_masked = None
        if t.claimed_phone and len(t.claimed_phone) >= 4:
            claimed_phone_masked = "***-***-" + t.claimed_phone[-4:]
        elif t.claimed_phone:
            claimed_phone_masked = "***"
        obj["claimed_phone_masked"] = claimed_phone_masked
        out.append(obj)
    return jsonify({"tickets": out})


GUEST_LINK_EXPIRY_HOURS = 48


@bp.get("/t/<token>")
def get_ticket(token: str):
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")
    if t.closed_at:
        age_hours = (datetime.utcnow() - t.closed_at).total_seconds() / 3600
        if age_hours > GUEST_LINK_EXPIRY_HOURS:
            abort(404, "This link has expired.")

    req = CarRequest.query.filter_by(ticket_id=t.id).order_by(CarRequest.id.desc()).first()
    return jsonify({"ticket": _json(t), "request": _json(req)})


@bp.get("/t/<token>/exits")
def ticket_exits(token: str):
    """Guest: list exits for this ticket's venue (no auth). Use this so guest page can load exits without calling /api/venues/:id."""
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")
    exits = Exit.query.filter_by(venue_id=t.venue_id, is_active=True).order_by(Exit.id.asc()).all()
    by_code = {}
    for e in exits:
        if e.code not in by_code:
            by_code[e.code] = e
    ordered = [by_code[c] for c in EXIT_CODE_ORDER if c in by_code]
    return jsonify([_json(e) for e in ordered])


@bp.get("/t/<token>/recommendations")
def guest_recommendations(token: str):
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    window_hours = request.args.get("window_hours", default=24, type=int)
    max_seconds = request.args.get("max_seconds", default=1800, type=int)
    queue_penalty = request.args.get("queue_penalty", default=30, type=int)

    stats = _exit_stats_for_venue(t.venue_id, window_hours=window_hours, max_seconds=max_seconds)

    for s in stats:
        s["score"] = float(s["eta_seconds"] + queue_penalty * s["queue"])

    best = min(stats, key=lambda x: x["score"]) if stats else None

    return jsonify({
        "ticket_token": token,
        "venue_id": t.venue_id,
        "recommended": best,
        "options": stats,
        "queue_penalty": queue_penalty,
        "window_hours": window_hours,
        "max_seconds": max_seconds,
    })


@bp.post("/t/<token>/request")
def request_car(token: str):
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    data = request.get_json(force=True)
    exit_id = data.get("exit_id")
    zone_id = data.get("zone_id")
    auto = data.get("auto", False)
    if not exit_id and not zone_id:
        abort(400, "exit_id or zone_id is required")

    chosen_zone = None
    if zone_id:
        chosen_zone = Zone.query.get_or_404(int(zone_id))
        if chosen_zone.venue_id != t.venue_id:
            abort(400, "zone does not belong to this venue")
        if not exit_id:
            exit_id = chosen_zone.default_exit_id

    if auto and not exit_id:
        stats = _exit_stats_for_venue(t.venue_id)
        if stats:
            queue_penalty = 30
            best = min(stats, key=lambda s: float(s["eta_seconds"] + queue_penalty * s["queue"]))
            exit_id = best["exit_id"]
        else:
            abort(400, "no exits available for auto selection")

    ex = Exit.query.get_or_404(int(exit_id))
    if ex.venue_id != t.venue_id:
        abort(400, "exit does not belong to this venue")

    # Scheduling: delay_minutes (int) or scheduled_for (ISO string)
    delay_minutes = data.get("delay_minutes", 0)
    scheduled_for_dt = None
    if "scheduled_for" in data and data["scheduled_for"]:
        try:
            raw = data["scheduled_for"].replace("Z", "+00:00")
            scheduled_for_dt = datetime.fromisoformat(raw)
            if scheduled_for_dt.tzinfo:
                scheduled_for_dt = scheduled_for_dt.astimezone(timezone.utc).replace(tzinfo=None)
            if scheduled_for_dt <= datetime.utcnow():
                abort(400, "scheduled_for must be in the future")
            delta = (scheduled_for_dt - datetime.utcnow()).total_seconds() / 60
            if delta > 120:
                abort(400, "scheduled_for must be within 120 minutes")
        except (ValueError, TypeError):
            abort(400, "scheduled_for must be a valid ISO 8601 datetime string")
    else:
        try:
            delay_minutes = int(delay_minutes)
        except (TypeError, ValueError):
            abort(400, "delay_minutes must be int")
        if delay_minutes < 0 or delay_minutes > 120:
            abort(400, "delay_minutes must be between 0 and 120")
        if delay_minutes > 0:
            scheduled_for_dt = datetime.utcnow() + timedelta(minutes=delay_minutes)

    # Idempotency: one active request per ticket (SCHEDULED counts as active)
    existing = (
        CarRequest.query
        .filter(CarRequest.ticket_id == t.id)
        .order_by(CarRequest.id.desc())
        .first()
    )
    if existing and str(existing.status) in ACTIVE_STATUSES:
        return jsonify({
            "request": _json(existing),
            "idempotent": True,
            "message": "Active request already exists for this ticket",
        }), 200

    now = datetime.utcnow()

    if scheduled_for_dt is not None:
        # Create SCHEDULED request
        delay_minutes_display = int((scheduled_for_dt - now).total_seconds() / 60)
        r = CarRequest(
            ticket_id=t.id,
            exit_id=ex.id,
            status=RequestStatus.SCHEDULED.value,
            zone_id=chosen_zone.id if chosen_zone else None,
            scheduled_for=scheduled_for_dt,
        )
        db.session.add(r)
        db.session.flush()

        ev = StatusEvent(
            ticket_id=t.id,
            request_id=r.id,
            from_status=None,
            to_status=RequestStatus.SCHEDULED.value,
            note=f"Scheduled for +{delay_minutes_display} min at exit {ex.code}",
        )
        db.session.add(ev)
        db.session.commit()

        msg = f"CurbKey: Scheduled in {delay_minutes_display} min for Exit {ex.code}."
        queue_and_send(ticket_id=t.id, request_id=r.id, status_event_id=ev.id, message=msg)

        return jsonify({"request": _json(r)}), 201

    # delay_minutes == 0: normal REQUESTED flow
    r = CarRequest(
        ticket_id=t.id,
        exit_id=ex.id,
        status=RequestStatus.REQUESTED.value,
        zone_id=chosen_zone.id if chosen_zone else None,
    )
    db.session.add(r)
    db.session.flush()

    ev = StatusEvent(
        ticket_id=t.id,
        request_id=r.id,
        from_status=None,
        to_status=RequestStatus.REQUESTED.value,
        note=f"Requested at exit {ex.code}",
    )
    db.session.add(ev)
    db.session.commit()

    return jsonify({"request": _json(r)}), 201


@bp.patch("/t/<token>/request/<int:req_id>/schedule")
def reschedule(token: str, req_id: int):
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    r = CarRequest.query.get_or_404(req_id)
    if r.ticket_id != t.id:
        abort(403, "not your request")

    if str(r.status) != "SCHEDULED":
        abort(400, "can only reschedule SCHEDULED requests")

    now = datetime.utcnow()
    # Delay rule: based on scheduled_for (UTC). No reschedule within 30s of scheduled time.
    # (Strict: we do not allow "push later only" within the window—cleaner and simpler.)
    if r.scheduled_for and now >= r.scheduled_for - timedelta(seconds=RESCHEDULE_MIN_SECONDS_BEFORE):
        abort(400, "cannot reschedule within 30 seconds of scheduled time")

    # Rate limit: max 3 reschedules per request. Count only events with note "Rescheduled to +X min".
    reschedule_events = (
        StatusEvent.query
        .filter(StatusEvent.request_id == r.id)
        .filter(StatusEvent.note.isnot(None), StatusEvent.note.like("%Rescheduled%"))
        .order_by(StatusEvent.created_at.desc())
        .all()
    )
    if len(reschedule_events) >= RESCHEDULE_MAX_PER_REQUEST:
        abort(400, "maximum 3 reschedules allowed for this request")

    # Cooldown: 10 seconds between reschedule changes
    if reschedule_events:
        last_at = reschedule_events[0].created_at
        if (now - last_at).total_seconds() < RESCHEDULE_COOLDOWN_SECONDS:
            abort(429, "please wait 10 seconds between reschedule changes")

    data = request.get_json(force=True)
    try:
        delay_minutes = int(data.get("delay_minutes", 0))
    except (TypeError, ValueError):
        abort(400, "delay_minutes must be int")
    if delay_minutes < 1 or delay_minutes > 120:
        abort(400, "delay_minutes must be 1..120")

    new_scheduled_for = now + timedelta(minutes=delay_minutes)
    if new_scheduled_for <= now:
        abort(400, "scheduled time must be in the future")
    r.scheduled_for = new_scheduled_for
    r.updated_at = now
    db.session.add(r)

    ev = StatusEvent(
        ticket_id=t.id,
        request_id=r.id,
        from_status="SCHEDULED",
        to_status="SCHEDULED",
        note=f"Rescheduled to +{delay_minutes} min",
    )
    db.session.add(ev)
    db.session.commit()

    return jsonify({"request": _json(r)})


@bp.post("/t/<token>/request/<int:req_id>/cancel")
def cancel_scheduled(token: str, req_id: int):
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    r = CarRequest.query.get_or_404(req_id)
    if r.ticket_id != t.id:
        abort(403, "not your request")

    if str(r.status) != "SCHEDULED":
        abort(400, "can only cancel SCHEDULED requests")

    now = datetime.utcnow()
    # Cooldown: cannot cancel within 10s of last change (same constant as reschedule)
    last_event = (
        StatusEvent.query
        .filter_by(request_id=r.id)
        .order_by(StatusEvent.created_at.desc())
        .first()
    )
    if last_event and (now - last_event.created_at).total_seconds() < RESCHEDULE_COOLDOWN_SECONDS:
        abort(429, "please wait 10 seconds after last change to cancel")

    # Cannot cancel within Ns of scheduled time (set CANCEL_MIN_SECONDS_BEFORE=30 to match reschedule)
    if r.scheduled_for and now >= r.scheduled_for - timedelta(seconds=CANCEL_MIN_SECONDS_BEFORE):
        abort(400, f"cannot cancel within {CANCEL_MIN_SECONDS_BEFORE} seconds of scheduled time")

    old = r.status
    r.status = "CANCELED"
    r.updated_at = now
    db.session.add(r)

    ev = StatusEvent(
        ticket_id=t.id,
        request_id=r.id,
        from_status=str(old),
        to_status="CANCELED",
        note="Canceled by guest",
    )
    db.session.add(ev)
    db.session.commit()

    return jsonify({"request": _json(r)})


@bp.post("/t/<token>/request/<int:req_id>/picked-up")
def guest_mark_picked_up(token: str, req_id: int):
    """Guest: mark request as picked up when status is READY (car at exit)."""
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    r = CarRequest.query.get_or_404(req_id)
    if r.ticket_id != t.id:
        abort(403, "not your request")
    if str(r.status) != "READY":
        abort(400, "can only mark picked up when car is ready")

    now = datetime.utcnow()
    r.status = RequestStatus.PICKED_UP.value
    r.updated_at = now
    db.session.add(StatusEvent(
        ticket_id=t.id,
        request_id=r.id,
        from_status="READY",
        to_status=RequestStatus.PICKED_UP.value,
        note="Got my car (guest)",
    ))
    r.status = "CLOSED"
    r.updated_at = now
    db.session.add(StatusEvent(
        ticket_id=t.id,
        request_id=r.id,
        from_status=RequestStatus.PICKED_UP.value,
        to_status="CLOSED",
        note="Auto-closed after pickup",
    ))
    if not t.closed_at:
        t.closed_at = now
        db.session.add(t)
    db.session.commit()

    return jsonify({"request": _json(r)})


@bp.post("/t/<token>/request/<int:req_id>/tip")
def guest_create_tip(token: str, req_id: int):
    """Record a tip for a request. Request must be closed and have a deliverer."""
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")
    r = CarRequest.query.get_or_404(req_id)
    if r.ticket_id != t.id:
        abort(403, "not your request")
    if str(r.status) not in ("CLOSED", "PICKED_UP") or r.delivered_by_user_id is None:
        abort(400, "cannot tip this request")

    data = request.get_json(silent=True) or {}
    amount_cents = data.get("amount_cents")
    if amount_cents is None:
        abort(400, "amount_cents required")
    try:
        amount_cents = int(amount_cents)
    except (TypeError, ValueError):
        abort(400, "amount_cents must be integer")
    if amount_cents < 100 or amount_cents > 5000:
        abort(400, "amount_cents must be between 100 and 5000")

    tip = Tip(request_id=r.id, amount_cents=amount_cents, status="PENDING")
    db.session.add(tip)
    db.session.commit()
    return jsonify({
        "tip": {"id": tip.id, "request_id": tip.request_id, "amount_cents": tip.amount_cents, "status": tip.status},
        "message": "Thanks! Your tip was recorded.",
    }), 201


HISTORY_STATUSES_LIST = ["CLOSED", "CANCELED"]


@bp.get("/api/requests")
@require_role(Role.VALET, Role.MANAGER)
def list_requests():
    """
    List requests. Ops cleanliness: default view = Active only; History = CLOSED/CANCELED.
    Query: scope=active|history (default active), limit=50 (max 100), cursor=<id>.
    active = SCHEDULED, REQUESTED, ASSIGNED, RETRIEVING, READY.
    history = CLOSED, CANCELED.
    Pagination: cursor is the last id from previous page; returns next_cursor for "load more".
    """
    venue_id = request.args.get("venue_id", type=int)
    status = request.args.get("status")
    exit_id = request.args.get("exit_id", type=int)
    scope = (request.args.get("scope") or "active").strip().lower()
    limit = request.args.get("limit", default=50, type=int)
    limit = min(max(1, limit), 100)
    cursor = request.args.get("cursor", type=int)

    if scope not in ("active", "history"):
        abort(400, "scope must be active or history")

    user = g.user
    if user.role == Role.VALET:
        venue_id = user.venue_id

    q = CarRequest.query
    if venue_id:
        q = q.join(Ticket, Ticket.id == CarRequest.ticket_id).filter(Ticket.venue_id == venue_id)
    if status:
        q = q.filter(CarRequest.status == status)
    if exit_id:
        q = q.filter(CarRequest.exit_id == exit_id)
    if scope == "active":
        q = q.filter(CarRequest.status.in_(ACTIVE_STATUSES))
    else:
        q = q.filter(CarRequest.status.in_(HISTORY_STATUSES_LIST))
    if cursor:
        q = q.filter(CarRequest.id < cursor)
    q = q.order_by(CarRequest.id.desc()).limit(limit + 1)
    reqs = q.all()
    has_more = len(reqs) > limit
    if has_more:
        reqs = reqs[:limit]
    next_cursor = reqs[-1].id if reqs and has_more else None
    return jsonify({
        "requests": [_json(r) for r in reqs],
        "next_cursor": next_cursor,
    })


@bp.get("/api/tips")
@require_role(Role.VALET, Role.MANAGER)
def list_tips():
    """List tips for a venue. Returns recent tips and totals per valet."""
    venue_id = request.args.get("venue_id", type=int)
    user = g.user
    if user.role == Role.VALET:
        venue_id = user.venue_id
    if not venue_id:
        abort(400, "venue_id is required")

    tips = (
        Tip.query.join(CarRequest, CarRequest.id == Tip.request_id)
        .join(Ticket, Ticket.id == CarRequest.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .order_by(Tip.created_at.desc())
        .limit(100)
        .all()
    )
    by_valet = {}
    for tip in tips:
        r = tip.request
        uid = r.delivered_by_user_id
        if uid is None:
            uid = 0
        if uid not in by_valet:
            u = r.delivered_by
            by_valet[uid] = {"user_id": uid, "email": u.email if u else None, "total_cents": 0, "count": 0}
        by_valet[uid]["total_cents"] += tip.amount_cents
        by_valet[uid]["count"] += 1

    tips_out = []
    for t in tips:
        ticket = t.request.ticket if t.request else None
        tips_out.append({
            "id": t.id,
            "request_id": t.request_id,
            "amount_cents": t.amount_cents,
            "status": t.status,
            "created_at": t.created_at.isoformat(),
            "vehicle_description": ticket.vehicle_description if ticket else None,
            "car_number": ticket.car_number if ticket else None,
        })
    return jsonify({
        "tips": tips_out,
        "by_valet": list(by_valet.values()),
    })


@bp.post("/api/requests/<int:req_id>/assign")
@require_role(Role.VALET, Role.MANAGER)
def assign_request(req_id: int):
    r = CarRequest.query.get_or_404(req_id)
    data = request.get_json(force=True)
    user = g.user
    assigned_to = (data.get("assigned_to") or "").strip()
    if user.role == Role.VALET:
        assigned_to = user.email
    if not assigned_to:
        abort(400, "assigned_to is required (string)")

    if user.role == Role.VALET and r.ticket.venue_id != user.venue_id:
        abort(403, "forbidden")

    if r.assigned_to and r.assigned_to != assigned_to:
        return jsonify({"error": "already assigned", "assigned_to": r.assigned_to}), 409

    old = r.status
    r.assigned_to = assigned_to
    r.assigned_at = datetime.utcnow()
    r.updated_at = datetime.utcnow()
    r.status = RequestStatus.ASSIGNED.value

    ev = StatusEvent(
        ticket_id=r.ticket_id,
        request_id=r.id,
        from_status=str(old),
        to_status=RequestStatus.ASSIGNED.value,
        note=f"Assigned to {assigned_to}",
    )
    db.session.add(ev)
    db.session.commit()

    return jsonify(_json(r))


@bp.patch("/api/requests/<int:req_id>/status")
@require_role(Role.VALET, Role.MANAGER)
def update_request_status(req_id: int):
    data = request.get_json(force=True)
    status = data.get("status")
    if not status:
        abort(400, "status is required")

    r = CarRequest.query.get_or_404(req_id)
    user = g.user
    if user.role == Role.VALET and r.ticket.venue_id != user.venue_id:
        abort(403, "forbidden")
    try:
        new_status = RequestStatus(status)
    except ValueError:
        abort(400, "invalid status")

    old = str(r.status)
    new = str(new_status.value)
    if new not in ALLOWED_TRANSITIONS.get(old, set()):
        abort(400, f"invalid transition: {old} -> {new}")

    ev = None
    if r.status != new_status.value:
        previous = r.status
        r.status = new_status.value
        r.updated_at = datetime.utcnow()
        now = datetime.utcnow()
        # track who delivered (valet who marked READY, or PICKED_UP if READY was skipped)
        if new == "READY":
            r.delivered_by_user_id = user.id
            r.delivered_at = now
        elif new == "PICKED_UP" and r.delivered_by_user_id is None:
            r.delivered_by_user_id = user.id
            r.delivered_at = now

        ev = StatusEvent(
            ticket_id=r.ticket_id,
            request_id=r.id,
            from_status=previous,
            to_status=new_status.value,
            note=None,
        )
        db.session.add(ev)

        if new == "PICKED_UP":
            r.status = "CLOSED"
            r.updated_at = datetime.utcnow()
            db.session.add(StatusEvent(
                ticket_id=r.ticket_id,
                request_id=r.id,
                from_status="PICKED_UP",
                to_status="CLOSED",
                note="Auto-closed after pickup",
            ))

            t = Ticket.query.get(r.ticket_id)
            if t and not t.closed_at:
                t.closed_at = datetime.utcnow()
                db.session.add(t)

    db.session.commit()

    if new_status.value == "READY" and ev:
        exit_code = r.exit.code if r.exit else None
        msg = _render_message(ticket_token=r.ticket.token, to_status=str(r.status), exit_code=exit_code)
        queue_and_send(ticket_id=r.ticket_id, request_id=r.id, status_event_id=ev.id, message=msg)
    return jsonify({"request": _json(r)})


@bp.get("/api/audit")
@require_role(Role.MANAGER)
def audit():
    venue_id = request.args.get("venue_id", type=int)
    if not venue_id:
        abort(400, "venue_id is required")

    events = (
        StatusEvent.query
        .join(Ticket, Ticket.id == StatusEvent.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .order_by(StatusEvent.id.desc())
        .limit(200)
        .all()
    )
    return jsonify([_json(e) for e in events])


@bp.get("/api/metrics")
@require_role(Role.MANAGER)
def metrics():
    venue_id = request.args.get("venue_id", type=int)
    if not venue_id:
        abort(400, "venue_id is required")

    window_hours = request.args.get("window_hours", type=int) or 24
    cutoff = datetime.utcnow() - timedelta(hours=window_hours)
    max_seconds = request.args.get("max_seconds", type=int) or 1800

    active_statuses = ["REQUESTED", "ASSIGNED", "RETRIEVING", "READY"]
    active_count = (
        db.session.query(func.count(CarRequest.id))
        .join(Ticket, Ticket.id == CarRequest.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .filter(CarRequest.status.in_(active_statuses))
        .scalar()
    )

    requested_ts = func.min(
        case((StatusEvent.to_status == "REQUESTED", StatusEvent.created_at), else_=None)
    )
    ready_ts = func.min(
        case((StatusEvent.to_status == "READY", StatusEvent.created_at), else_=None)
    )
    picked_ts = func.min(
        case((StatusEvent.to_status == "PICKED_UP", StatusEvent.created_at), else_=None)
    )

    per_req = (
        db.session.query(
            StatusEvent.request_id.label("rid"),
            requested_ts.label("requested_at"),
            ready_ts.label("ready_at"),
            picked_ts.label("picked_at"),
        )
        .join(Ticket, Ticket.id == StatusEvent.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .filter(StatusEvent.created_at >= cutoff)
        .group_by(StatusEvent.request_id)
        .subquery()
    )

    ready_duration = func.extract("epoch", per_req.c.ready_at - per_req.c.requested_at)
    picked_duration = func.extract("epoch", per_req.c.picked_at - per_req.c.requested_at)

    avg_req_to_ready = db.session.query(
        func.avg(ready_duration)
    ).filter(
        per_req.c.ready_at.isnot(None),
        per_req.c.requested_at.isnot(None),
        ready_duration <= max_seconds,
    ).scalar()

    avg_req_to_picked = db.session.query(
        func.avg(picked_duration)
    ).filter(
        per_req.c.picked_at.isnot(None),
        per_req.c.requested_at.isnot(None),
        picked_duration <= max_seconds,
    ).scalar()

    return jsonify({
        "venue_id": venue_id,
        "active_queue": int(active_count or 0),
        "window_hours": window_hours,
        "max_seconds": max_seconds,
        "avg_req_to_ready_seconds": float(avg_req_to_ready or 0.0),
        "avg_req_to_picked_seconds": float(avg_req_to_picked or 0.0),
    })


@bp.get("/api/stats")
@require_role(Role.VALET, Role.MANAGER)
def simple_stats():
    """Requests today + avg time to ready (minutes). For Valet/Manager dashboard."""
    venue_id = getattr(g.user, "venue_id", None) or request.args.get("venue_id", type=int)
    if not venue_id:
        abort(400, "venue_id required")
    user = g.user
    if user.role == Role.VALET:
        venue_id = user.venue_id
    cutoff = datetime.utcnow() - timedelta(hours=24)
    requests_today = (
        db.session.query(func.count(CarRequest.id))
        .join(Ticket, Ticket.id == CarRequest.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .filter(CarRequest.created_at >= cutoff)
        .scalar()
    )
    req_ts = func.min(
        case((StatusEvent.to_status == "REQUESTED", StatusEvent.created_at), else_=None)
    )
    rdy_ts = func.min(
        case((StatusEvent.to_status == "READY", StatusEvent.created_at), else_=None)
    )
    subq = (
        db.session.query(
            StatusEvent.request_id.label("rid"),
            req_ts.label("requested_at"),
            rdy_ts.label("ready_at"),
        )
        .join(Ticket, Ticket.id == StatusEvent.ticket_id)
        .filter(Ticket.venue_id == venue_id)
        .filter(StatusEvent.created_at >= cutoff)
        .group_by(StatusEvent.request_id)
        .subquery()
    )
    avg_sec = db.session.query(
        func.avg(func.extract("epoch", subq.c.ready_at - subq.c.requested_at))
    ).filter(
        subq.c.ready_at.isnot(None),
        subq.c.requested_at.isnot(None),
    ).scalar()
    avg_time_to_ready_min = round(float(avg_sec or 0) / 60, 1) if avg_sec else None
    return jsonify({
        "venue_id": venue_id,
        "requests_today": int(requests_today or 0),
        "avg_time_to_ready_min": avg_time_to_ready_min,
    })


@bp.get("/api/exit-stats")
@require_role(Role.VALET, Role.MANAGER)
def exit_stats():
    venue_id = getattr(g.user, "venue_id", None) or request.args.get("venue_id", type=int)
    if not venue_id:
        abort(400, "venue_id required")

    window_hours = request.args.get("window_hours", default=24, type=int)
    max_seconds = request.args.get("max_seconds", default=1800, type=int)

    stats = _exit_stats_for_venue(venue_id, window_hours=window_hours, max_seconds=max_seconds)
    return jsonify({
        "venue_id": venue_id,
        "window_hours": window_hours,
        "max_seconds": max_seconds,
        "exits": stats,
    })
