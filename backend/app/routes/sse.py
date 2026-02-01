import json
import time
from flask import Blueprint, Response, request, stream_with_context, abort

from app.models import Ticket, StatusEvent
from app.extensions import db

bp = Blueprint("sse", __name__)

# Max stream duration (seconds). Keeps workers from being held forever on free-tier hosts.
SSE_MAX_DURATION = 50


@bp.get("/t/<token>/events")
def ticket_events(token: str):
    t = Ticket.query.filter_by(token=token).first()
    if not t:
        abort(404, "ticket not found")

    last_id = request.args.get("last_id", default=0, type=int)
    ticket_id = t.id

    def gen():
        nonlocal last_id
        start = time.monotonic()
        yield ": connected\n\n"

        while (time.monotonic() - start) < SSE_MAX_DURATION:
            try:
                events = (
                    StatusEvent.query.filter(
                        StatusEvent.ticket_id == ticket_id,
                        StatusEvent.id > last_id,
                    )
                    .order_by(StatusEvent.id.asc())
                    .limit(50)
                    .all()
                )

                for ev in events:
                    payload = {
                        "id": int(ev.id),
                        "request_id": ev.request_id,
                        "from_status": ev.from_status,
                        "to_status": ev.to_status,
                        "note": ev.note,
                        "created_at": ev.created_at.isoformat(),
                    }
                    last_id = int(ev.id)
                    yield f"id: {payload['id']}\n"
                    yield "event: status\n"
                    yield f"data: {json.dumps(payload)}\n\n"

            finally:
                db.session.remove()

            time.sleep(1)

    return Response(
        stream_with_context(gen()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
