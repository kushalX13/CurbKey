from datetime import datetime
from flask import Blueprint, jsonify

from app.extensions import db
from app.models import Request as CarRequest, StatusEvent, Role
from app.routes.notifs import queue_and_send
from app.auth import require_role

bp = Blueprint("scheduler", __name__)


def run_scheduler_tick() -> int:
    """
    Promote SCHEDULED requests (scheduled_for <= now) to REQUESTED.
    Safe for multiple workers (FOR UPDATE SKIP LOCKED). Returns number flipped.
    Call from API route or worker CLI; requires app context.
    """
    now = datetime.utcnow()
    due = (
        db.session.query(CarRequest)
        .filter(CarRequest.status == "SCHEDULED")
        .filter(CarRequest.scheduled_for.isnot(None))
        .filter(CarRequest.scheduled_for <= now)
        .order_by(CarRequest.scheduled_for.asc())
        .with_for_update(skip_locked=True)
        .limit(100)
        .all()
    )

    flipped = 0
    for r in due:
        if r.status != "SCHEDULED":
            continue
        old = r.status
        r.status = "REQUESTED"
        r.updated_at = now
        db.session.add(r)
        db.session.flush()

        ev = StatusEvent(
            ticket_id=r.ticket_id,
            request_id=r.id,
            from_status=str(old),
            to_status="REQUESTED",
            note="Auto-triggered from schedule",
        )
        db.session.add(ev)
        db.session.flush()

        msg = "CurbKey: Scheduled request started. We'll notify you when ready."
        queue_and_send(ticket_id=r.ticket_id, request_id=r.id, status_event_id=ev.id, message=msg)
        flipped += 1

    db.session.commit()
    return flipped


@bp.post("/api/scheduler/tick")
@require_role(Role.MANAGER)
def scheduler_tick():
    flipped = run_scheduler_tick()
    return jsonify({"ok": True, "flipped": flipped})
