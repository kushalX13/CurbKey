from __future__ import annotations

from datetime import datetime
import os

from app.extensions import db
from app.models import NotificationOutbox

NOTIF_PROVIDER = os.getenv("NOTIF_PROVIDER", "stub").lower()  # stub | smtp | twilio | sendgrid ...


def send_outbox_item(item: NotificationOutbox) -> None:
    """
    Sends one outbox item using the configured provider.
    For now: STUB provider (free) that just marks SENT and prints.
    """
    if item.state != "PENDING":
        return

    try:
        if NOTIF_PROVIDER == "stub":
            # Demo mode: pretend it was sent
            print(f"[NOTIF:STUB] to={item.channel}:{item.target} msg={item.message}")
            item.state = "SENT"
            item.sent_at = datetime.utcnow()
            item.provider_id = "stub"
        else:
            # Future: plug in smtp/twilio/sendgrid here
            raise NotImplementedError(f"Provider not implemented: {NOTIF_PROVIDER}")

        db.session.add(item)
        db.session.commit()

    except Exception as e:
        item.state = "FAILED"
        item.error = str(e)
        db.session.add(item)
        db.session.commit()
