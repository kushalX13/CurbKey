#!/usr/bin/env python3
"""
One-command demo: seed + create ticket + print guest URL.
Requires backend running (e.g. make dev or flask run --port 5001).
Usage: make demo  or  python3 scripts/demo.py [BASE_URL]
"""
import json
import socket
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5001"
FRONTEND = "http://127.0.0.1:3000"


TIMEOUT = 30


def req(method: str, path: str, data: dict | None = None, headers: dict | None = None) -> dict:
    url = f"{BASE}{path}"
    h = {"Content-Type": "application/json", **(headers or {})}
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=TIMEOUT) as res:
        return json.loads(res.read().decode())


def main():
    if len(sys.argv) > 1:
        global BASE
        BASE = sys.argv[1].rstrip("/")

    try:
        # Seed (venue + manager)
        try:
            req("POST", "/auth/seed", {"email": "admin@curbkey.com", "password": "admin123"})
        except urllib.error.HTTPError as e:
            if e.code != 200:
                raise

        # Login → JWT
        out = req("POST", "/auth/login", {"email": "admin@curbkey.com", "password": "admin123"})
        jwt = out["access_token"]

        # Create ticket (manager-only)
        out = req(
            "POST", "/api/demo/tickets", {},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        token = out["token"]
        guest_path = out.get("guest_url", f"/t/{token}")

        guest_url = f"{FRONTEND}{guest_path}"
        print(guest_url)
    except urllib.error.URLError as e:
        reason = e.reason
        refused = (
            getattr(reason, "errno", None) == 61
            or "refused" in str(reason).lower()
            or "refused" in str(e).lower()
        )
        if refused:
            print("Backend not running. Start it with: make dev", file=sys.stderr)
            sys.exit(1)
        raise
    except (TimeoutError, socket.timeout):
        print("Backend timed out. Is it running? Try: make dev", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
