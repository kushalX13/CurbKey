from datetime import datetime
from flask import Blueprint, jsonify, request, abort

from app.extensions import db
from app.models import (
    Ticket, Request as CarRequest, StatusEvent,
    NotificationSubscription, NotificationOutbox
)
from app.services.notifier import send_outbox_item
from app.auth import require_role
from app.models import Role

bp = Blueprint("notifs", __name__)


def _render_message(ticket_token: str, to_status: str, exit_code: str | None = None) -> str:
    # keep it short (SMS-friendly). You can expand later.
    if to_status == "READY":
        return f"CurbKey: Your car is ready at Exit {exit_code or '?'}."
    if to_status == "RETRIEVING":
        return f"CurbKey: Your car is being retrieved."
    if to_status == "REQUESTED":
        return f"CurbKey: Request received. We’ll notify you when your car is ready."
    if to_status == "CLOSED":
        return "CurbKey: Pickup complete. Thanks!"
    return f"CurbKey: Status update → {to_status}"


def queue_and_send(ticket_id: int, request_id: int | None, status_event_id: int | None, message: str) -> list[dict]:
    subs = NotificationSubscription.query.filter_by(ticket_id=ticket_id, is_active=True).all()
    created = []

    for s in subs:
        ob = NotificationOutbox(
            ticket_id=ticket_id,
            request_id=request_id,
            status_event_id=status_event_id,
            channel=s.channel,
            target=s.target,
            message=message,
            state="PENDING",
        )
        db.session.add(ob)
        db.session.flush()  # get ob.id
        created.append({"id": int(ob.id), "channel": ob.channel, "target": ob.target, "state": ob.state})

    db.session.commit()

    # send immediately (simple + fine for MVP)
    for c in created:
        ob = NotificationOutbox.query.get(c["id"])
        send_outbox_item(ob)

    return created


@bp.post("/t/<token>/subscribe")
def subscribe(token: str):
    """
    Guest subscribes to updates.
    Body: { "channel": "SMS"|"EMAIL"|"WHATSAPP"|"STUB", "target": "...", "active": true }
    """
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    data = request.get_json(force=True)
    channel = (data.get("channel") or "STUB").upper()
    target = (data.get("target") or "").strip()
    active = bool(data.get("active", True))

    if channel not in {"STUB", "EMAIL", "SMS", "WHATSAPP"}:
        abort(400, "invalid channel")
    if channel != "STUB" and not target:
        abort(400, "target required for EMAIL/SMS/WHATSAPP")

    sub = NotificationSubscription(ticket_id=t.id, channel=channel, target=target or "stub", is_active=active)
    db.session.add(sub)
    db.session.commit()

    return jsonify({"ok": True, "subscription_id": sub.id}), 201


@bp.get("/t/<token>/outbox")
def guest_outbox(token: str):
    """
    Demo/debug: show notifications sent for this ticket.
    """
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    items = (NotificationOutbox.query
             .filter(NotificationOutbox.ticket_id == t.id)
             .order_by(NotificationOutbox.id.desc())
             .limit(50).all())

    return jsonify([{
        "id": int(i.id),
        "channel": i.channel,
        "target": i.target,
        "state": i.state,
        "retry_count": i.retry_count,
        "message": i.message,
        "created_at": i.created_at.isoformat(),
        "sent_at": i.sent_at.isoformat() if i.sent_at else None,
    } for i in items])


@bp.post("/api/notifs/emit-test")
def emit_test():
    """
    Dev helper: emit a test notification for a ticket_id
    Body: {ticket_id: 1, message:"hi"}
    """
    data = request.get_json(force=True)
    ticket_id = int(data.get("ticket_id") or 0)
    message = (data.get("message") or "").strip()
    if not ticket_id or not message:
        abort(400, "ticket_id and message required")

    created = queue_and_send(ticket_id=ticket_id, request_id=None, status_event_id=None, message=message)
    return jsonify({"created": created})


def run_drain(state: str = "PENDING", limit: int = 50) -> dict:
    """
    Process outbox items in the given state; mark SENT or FAILED.
    Call from API route or worker CLI; requires app context.
    Returns {"queued": n, "sent": m}.
    """
    if state not in ("PENDING", "FAILED"):
        raise ValueError("state must be PENDING or FAILED")
    items = (
        NotificationOutbox.query
        .filter(NotificationOutbox.state == state)
        .order_by(NotificationOutbox.id.asc())
        .limit(limit)
        .all()
    )
    sent = 0
    for item in items:
        send_outbox_item(item)
        if item.state == "SENT":
            sent += 1
    return {"queued": len(items), "sent": sent}


@bp.post("/api/notifs/drain")
@require_role(Role.MANAGER)
def drain():
    """
    Process outbox items. Query: state=PENDING|FAILED (default PENDING), limit=50.
    Idempotent: sends items in the given state; marks SENT or FAILED.
    Part of outbox pattern: drain + retry to guarantee delivery.
    """
    limit = request.args.get("limit", default=50, type=int)
    state_param = (request.args.get("state") or "PENDING").strip().upper()
    if state_param not in ("PENDING", "FAILED"):
        abort(400, "state must be PENDING or FAILED")
    result = run_drain(state=state_param, limit=limit)
    return jsonify({**result, "limit": limit, "state": state_param})


@bp.post("/api/notifs/retry")
@require_role(Role.MANAGER)
def retry():
    """
    Mark FAILED items back to PENDING for redelivery (increment retry_count).
    Query: limit=50, older_than_seconds=30 (optional; only retry items created >30s ago).
    Next drain will pick them up. Part of outbox pattern: drain + retry to guarantee delivery.
    """
    from datetime import datetime, timedelta

    limit = request.args.get("limit", default=50, type=int)
    older_than_seconds = request.args.get("older_than_seconds", default=30, type=int)
    cutoff = datetime.utcnow() - timedelta(seconds=older_than_seconds)

    items = (
        NotificationOutbox.query
        .filter(NotificationOutbox.state == "FAILED")
        .filter(NotificationOutbox.created_at <= cutoff)
        .order_by(NotificationOutbox.id.asc())
        .limit(limit)
        .all()
    )

    for item in items:
        item.state = "PENDING"
        item.retry_count = (item.retry_count or 0) + 1
        item.error = None
        db.session.add(item)

    db.session.commit()
    return jsonify({
        "ok": True,
        "retried": len(items),
        "limit": limit,
        "older_than_seconds": older_than_seconds,
    })
