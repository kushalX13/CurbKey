#!/usr/bin/env python3
"""
CurbKey sample run: full flow from seed → scheduled request → scheduler tick → outbox.
Run with backend at BASE (default http://127.0.0.1:5001). No extra deps (stdlib only).
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5001"


def req(method: str, path: str, data: dict | None = None, headers: dict | None = None) -> dict:
    url = f"{BASE}{path}"
    h = {"Content-Type": "application/json", **(headers or {})}
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
        except Exception:
            err = body
        print(f"  HTTP {e.code} -> {err}")
        raise


def main():
    print("CurbKey sample run (backend at", BASE, ")\n")

    # 1) Seed (creates venue + manager)
    print("1) POST /auth/seed")
    try:
        out = req("POST", "/auth/seed", {"venue_name": "Sample Venue", "email": "admin@curbkey.com", "password": "admin123"})
        print("   ->", out.get("message", out), "\n")
    except urllib.error.HTTPError as e:
        if e.code == 200:
            print("   -> already seeded\n")
        else:
            raise

    # 2) Login → JWT
    print("2) POST /auth/login")
    out = req("POST", "/auth/login", {"email": "admin@curbkey.com", "password": "admin123"})
    jwt = out["access_token"]
    print("   -> JWT obtained\n")

    auth = {"Authorization": f"Bearer {jwt}"}

    # 3) Create exit (venue_id=1 from seed)
    print("3) POST /api/venues/1/exits")
    out = req("POST", "/api/venues/1/exits", {"name": "Main Gate", "code": "A"}, headers=auth)
    exit_id = out["id"]
    print("   -> exit_id =", exit_id, "\n")

    # 4) Create ticket
    print("4) POST /api/tickets")
    out = req("POST", "/api/tickets", {"venue_id": 1})
    token = out["ticket"]["token"]
    print("   -> ticket token =", token[:16] + "...\n")

    # 5) Subscribe (STUB)
    print("5) POST /t/<token>/subscribe")
    req("POST", f"/t/{token}/subscribe", {"channel": "STUB", "target": "stub"})
    print("   -> subscribed\n")

    # 6) Create scheduled request (+1 min)
    print("6) POST /t/<token>/request (delay_minutes=1)")
    out = req("POST", f"/t/{token}/request", {"exit_id": exit_id, "delay_minutes": 1})
    r = out["request"]
    print("   -> status =", r["status"], "| scheduled_for =", r.get("scheduled_for"))
    if r["status"] != "SCHEDULED" and not r.get("scheduled_for"):
        print("   (Expected SCHEDULED with scheduled_for; restart backend if you added scheduling recently.)")
    print()

    # 7) Get ticket + request
    print("7) GET /t/<token>")
    out = req("GET", f"/t/{token}")
    print("   -> request status =", out["request"]["status"], "\n")

    # 8) Wait for scheduled time then tick (so we see SCHEDULED → REQUESTED)
    wait = "--wait" in sys.argv or "-w" in sys.argv
    if wait:
        print("8) Waiting 65s for scheduled_for...")
        time.sleep(65)
    print("9) POST /api/scheduler/tick")
    try:
        out = req("POST", "/api/scheduler/tick", data={}, headers=auth)
        flipped = out.get("flipped", 0)
        print("   -> flipped =", flipped)
        if not wait and flipped == 0:
            print("   (scheduled_for is 1 min ahead; run with --wait to sleep 65s then tick)\n")
        else:
            print()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("   -> 404 Not Found. Restart the backend so /api/scheduler/tick is loaded (scheduler blueprint).\n")
        else:
            raise

    # 10) Get ticket again → request should be REQUESTED (if we waited)
    print("10) GET /t/<token>")
    out = req("GET", f"/t/{token}")
    print("   -> request status =", out["request"]["status"], "\n")

    # 11) Outbox
    print("11) GET /t/<token>/outbox")
    out = req("GET", f"/t/{token}/outbox")
    for i, item in enumerate(out[:5]):
        print("   ", i + 1, ")", item.get("message", item)[:60] + ("..." if len(item.get("message", "")) > 60 else ""))

    print("\nDone. Guest page (if frontend on 3000): http://127.0.0.1:3000/t/" + token)


if __name__ == "__main__":
    for a in sys.argv[1:]:
        if a in ("--wait", "-w"):
            continue
        if not a.startswith("-"):
            BASE = a.rstrip("/")
            break
    main()
