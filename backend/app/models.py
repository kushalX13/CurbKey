from datetime import datetime
import enum
import secrets

from app.extensions import db


class Role(enum.StrEnum):
    VALET = "VALET"
    MANAGER = "MANAGER"


class RequestStatus(enum.StrEnum):
    SCHEDULED = "SCHEDULED"
    REQUESTED = "REQUESTED"
    ASSIGNED = "ASSIGNED"
    RETRIEVING = "RETRIEVING"
    READY = "READY"
    PICKED_UP = "PICKED_UP"
    CLOSED = "CLOSED"
    CANCELED = "CANCELED"


class NotificationChannel(enum.StrEnum):
    STUB = "STUB"
    EMAIL = "EMAIL"
    SMS = "SMS"
    WHATSAPP = "WHATSAPP"


class Venue(db.Model):
    __tablename__ = "venues"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    slug = db.Column(db.String(80), unique=True, nullable=True, index=True)  # for /v/<slug> claim flow
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    exits = db.relationship("Exit", backref="venue", lazy=True)
    zones = db.relationship("Zone", backref="venue", lazy=True)


class Exit(db.Model):
    __tablename__ = "exits"
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=False)

    name = db.Column(db.String(80), nullable=False)     # e.g., "Main Gate"
    code = db.Column(db.String(20), nullable=False)     # e.g., "A", "B", "PATIO"
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Zone(db.Model):
    __tablename__ = "zones"
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=False)

    name = db.Column(db.String(80), nullable=False)  # e.g., "Patio"
    default_exit_id = db.Column(db.Integer, db.ForeignKey("exits.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    default_exit = db.relationship("Exit")


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=True)

    email = db.Column(db.String(180), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)  # we’ll wire auth later
    role = db.Column(db.Enum(Role), nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Ticket(db.Model):
    __tablename__ = "tickets"
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=False)

    token = db.Column(db.String(64), unique=True, nullable=False, index=True)
    car_number = db.Column(db.String(40), nullable=True)  # license plate / car id — valet sets when receiving car
    claim_code = db.Column(db.String(12), nullable=True, index=True)  # 6-digit human code, unique per venue
    claim_code_expires_at = db.Column(db.DateTime, nullable=True)
    claimed_phone = db.Column(db.String(40), nullable=True)
    claimed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    closed_at = db.Column(db.DateTime, nullable=True)

    requests = db.relationship("Request", backref="ticket", lazy=True)

    @staticmethod
    def new_token() -> str:
        return secrets.token_urlsafe(16)


class Request(db.Model):
    __tablename__ = "requests"
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id"), nullable=False)
    exit_id = db.Column(db.Integer, db.ForeignKey("exits.id"), nullable=False)

    status = db.Column(db.String(30), default=RequestStatus.REQUESTED.value, nullable=False)
    scheduled_for = db.Column(db.DateTime, nullable=True)
    assigned_to = db.Column(db.String(80), nullable=True)
    assigned_at = db.Column(db.DateTime, nullable=True)
    zone_id = db.Column(db.Integer, db.ForeignKey("zones.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    exit = db.relationship("Exit")
    zone = db.relationship("Zone", foreign_keys=[zone_id])

    events = db.relationship("StatusEvent", backref="request", lazy=True)


class StatusEvent(db.Model):
    __tablename__ = "status_events"
    id = db.Column(db.BigInteger().with_variant(db.Integer(), "sqlite"), primary_key=True, autoincrement=True)  # grows safely
    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id"), nullable=False)
    request_id = db.Column(db.Integer, db.ForeignKey("requests.id"), nullable=False)

    from_status = db.Column(db.String(30), nullable=True)
    to_status = db.Column(db.String(30), nullable=False)

    note = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class NotificationSubscription(db.Model):
    __tablename__ = "notification_subscriptions"
    id = db.Column(db.Integer, primary_key=True)

    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id"), nullable=False, index=True)
    channel = db.Column(db.String(20), nullable=False)
    target = db.Column(db.String(180), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class NotificationOutbox(db.Model):
    __tablename__ = "notification_outbox"
    id = db.Column(db.BigInteger().with_variant(db.Integer(), "sqlite"), primary_key=True, autoincrement=True)

    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id"), nullable=False, index=True)
    request_id = db.Column(db.Integer, db.ForeignKey("requests.id"), nullable=True)
    status_event_id = db.Column(db.BigInteger, db.ForeignKey("status_events.id"), nullable=True)

    channel = db.Column(db.String(20), nullable=False)
    target = db.Column(db.String(180), nullable=False)
    message = db.Column(db.Text, nullable=False)

    state = db.Column(db.String(20), default="PENDING", nullable=False)
    retry_count = db.Column(db.Integer, default=0, nullable=False)
    provider_id = db.Column(db.String(120), nullable=True)
    error = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    sent_at = db.Column(db.DateTime, nullable=True)
