"""
Minimal high-value tests for core flows:
- Scheduling: create SCHEDULED, tick flips once, second tick does nothing
- Idempotency: second request returns idempotent: true
- Auth: valet cannot reset demo, guest cannot call protected endpoints

Scheduler tick tests require Postgres (FOR UPDATE SKIP LOCKED); they are skipped on SQLite.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.models import Request as CarRequest, RequestStatus

_using_postgres = "postgresql" in os.environ.get("DATABASE_URL", "")


# --- Scheduling ---


def test_create_scheduled(client, seed_data, exit_a):
    """POST /t/<token>/request with delay_minutes creates SCHEDULED request."""
    ticket = seed_data["ticket"]
    db.session.commit()
    r = client.post(
        f"/t/{ticket.token}/request",
        json={"exit_id": exit_a.id, "delay_minutes": 1},
        content_type="application/json",
    )
    assert r.status_code == 201
    data = r.get_json()
    assert data["request"]["status"] == RequestStatus.SCHEDULED
    assert data["request"]["scheduled_for"] is not None


@pytest.mark.skipif(not _using_postgres, reason="scheduler tick uses FOR UPDATE SKIP LOCKED (Postgres)")
def test_tick_flips_once(client, seed_data, manager_jwt, exit_a, ctx):
    """Scheduler tick promotes SCHEDULED -> REQUESTED once."""
    ticket = seed_data["ticket"]
    # Create SCHEDULED request with scheduled_for in the past so tick picks it up
    now = datetime.utcnow()
    past = now - timedelta(seconds=10)
    req = CarRequest(
        ticket_id=ticket.id,
        exit_id=exit_a.id,
        status=RequestStatus.SCHEDULED.value,
        scheduled_for=past,
    )
    db.session.add(req)
    db.session.commit()

    r = client.post(
        "/api/scheduler/tick",
        headers={"Authorization": f"Bearer {manager_jwt}", "Content-Type": "application/json"},
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert data["flipped"] == 1

    req = CarRequest.query.get(req.id)
    assert req.status == RequestStatus.REQUESTED.value


@pytest.mark.skipif(not _using_postgres, reason="scheduler tick uses FOR UPDATE SKIP LOCKED (Postgres)")
def test_second_tick_does_nothing(client, seed_data, manager_jwt, exit_a, ctx):
    """Second tick does not flip again (idempotent tick)."""
    ticket = seed_data["ticket"]
    now = datetime.utcnow()
    past = now - timedelta(seconds=10)
    req = CarRequest(
        ticket_id=ticket.id,
        exit_id=exit_a.id,
        status=RequestStatus.SCHEDULED.value,
        scheduled_for=past,
    )
    db.session.add(req)
    db.session.commit()

    # First tick
    r1 = client.post(
        "/api/scheduler/tick",
        headers={"Authorization": f"Bearer {manager_jwt}", "Content-Type": "application/json"},
    )
    assert r1.status_code == 200
    assert r1.get_json()["flipped"] == 1

    # Second tick: nothing to flip
    r2 = client.post(
        "/api/scheduler/tick",
        headers={"Authorization": f"Bearer {manager_jwt}", "Content-Type": "application/json"},
    )
    assert r2.status_code == 200
    assert r2.get_json()["flipped"] == 0


# --- Idempotency ---


def test_second_request_returns_idempotent(client, seed_data, exit_a):
    """Second POST /t/<token>/request (while active request exists) returns idempotent: true."""
    ticket = seed_data["ticket"]
    db.session.commit()

    # First request: REQUESTED (delay_minutes=0)
    r1 = client.post(
        f"/t/{ticket.token}/request",
        json={"exit_id": exit_a.id},
        content_type="application/json",
    )
    assert r1.status_code == 201
    assert r1.get_json().get("idempotent") is not True

    # Second request: same ticket, should return existing request with idempotent
    r2 = client.post(
        f"/t/{ticket.token}/request",
        json={"exit_id": exit_a.id},
        content_type="application/json",
    )
    assert r2.status_code == 200
    data = r2.get_json()
    assert data.get("idempotent") is True
    assert "request" in data
    assert data["request"]["status"] == RequestStatus.REQUESTED.value


# --- Auth boundaries ---


def test_valet_cannot_reset_demo(client, valet_jwt):
    """Valet calling POST /api/demo/reset gets 403."""
    r = client.post(
        "/api/demo/reset",
        json={},
        headers={"Authorization": f"Bearer {valet_jwt}", "Content-Type": "application/json"},
    )
    assert r.status_code == 403


def test_guest_cannot_call_protected_endpoints(client):
    """Guest (no JWT) calling protected endpoints gets 401."""
    # POST /api/scheduler/tick (manager-only)
    r1 = client.post(
        "/api/scheduler/tick",
        json={},
        content_type="application/json",
    )
    assert r1.status_code == 401

    # GET /api/requests (valet/manager)
    r2 = client.get(
        "/api/requests?venue_id=1&scope=active",
        content_type="application/json",
    )
    assert r2.status_code == 401
