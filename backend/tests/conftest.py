"""
Pytest fixtures for core flow tests.
Uses in-memory SQLite so no Postgres required.
"""
import os
import pytest
from werkzeug.security import generate_password_hash

# In-memory SQLite for speed; use env to override for Postgres in CI
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

from sqlalchemy import text

from app import create_app
from app.extensions import db
from app.models import (
    Venue, Exit, Zone, Ticket, Request as CarRequest, User,
    Role, RequestStatus,
)


@pytest.fixture
def app():
    # CI: use DATABASE_URL as-is (Postgres) so scheduler tick tests run.
    # Local: force in-memory SQLite so no Postgres required.
    url = os.environ.get("DATABASE_URL", "")
    if "postgresql" in url:
        app = create_app()
        app.config["TESTING"] = True
        return app
    prev = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"
    try:
        app = create_app()
        app.config["TESTING"] = True
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        return app
    finally:
        if prev is not None:
            os.environ["DATABASE_URL"] = prev
        elif "DATABASE_URL" in os.environ:
            del os.environ["DATABASE_URL"]


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def app_context(app):
    with app.app_context():
        yield


@pytest.fixture
def db_tables(app, app_context):
    url = os.environ.get("DATABASE_URL", "")
    if "postgresql" in url:
        # CI: schema from migrations; truncate so each test run has clean data
        db.session.execute(text(
            "TRUNCATE notification_outbox, notification_subscriptions, status_events, "
            "requests, zones, tickets, users, exits, venues RESTART IDENTITY CASCADE"
        ))
        db.session.commit()
    else:
        db.create_all()
    yield
    db.session.remove()
    if "postgresql" not in url:
        db.drop_all()


@pytest.fixture
def ctx(app):
    """Push app context for the whole test (so test body can use db.session)."""
    with app.app_context():
        yield


@pytest.fixture
def venue(app_context, db_tables):
    v = Venue(name="Test Venue")
    db.session.add(v)
    db.session.flush()
    return v


@pytest.fixture
def exit_a(venue):
    ex = Exit(venue_id=venue.id, code="A", name="Main Gate")
    db.session.add(ex)
    db.session.flush()
    return ex


@pytest.fixture
def ticket(venue, exit_a):
    t = Ticket(venue_id=venue.id, token=Ticket.new_token())
    db.session.add(t)
    db.session.flush()
    return t


@pytest.fixture
def manager_user(venue):
    u = User(
        email="manager@test.com",
        password_hash=generate_password_hash("pass"),
        role=Role.MANAGER,
        venue_id=venue.id,
    )
    db.session.add(u)
    db.session.flush()
    return u


@pytest.fixture
def valet_user(venue):
    u = User(
        email="valet@test.com",
        password_hash=generate_password_hash("pass"),
        role=Role.VALET,
        venue_id=venue.id,
    )
    db.session.add(u)
    db.session.flush()
    return u


@pytest.fixture
def seed_data(db_tables, venue, exit_a, ticket, manager_user, valet_user):
    db.session.commit()
    return {
        "venue": venue,
        "exit": exit_a,
        "ticket": ticket,
        "manager": manager_user,
        "valet": valet_user,
    }


def jwt_for_user(app, user):
    from flask_jwt_extended import create_access_token
    with app.app_context():
        return create_access_token(identity=str(user.id))


@pytest.fixture
def manager_jwt(app, seed_data):
    return jwt_for_user(app, seed_data["manager"])


@pytest.fixture
def valet_jwt(app, seed_data):
    return jwt_for_user(app, seed_data["valet"])


def auth_headers(jwt_token):
    return {"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"}
