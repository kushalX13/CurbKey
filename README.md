# CurbKey

Valet request and scheduling: guests request their car (now or scheduled), valets update status, managers run the scheduler and notifications. Built for demo and interview clarity.

- **Guest:** ticket link → request car, schedule (+1 min), see status live (SSE).
- **Valet:** Active/History requests, Retrieving → Ready → Picked up.
- **Manager:** Demo kit (seed, create ticket, copy guest link, reset), scheduler tick, drain/retry notifications.

---

## One-command dev & demo

**Start everything (DB + backend + frontend):**

```bash
cd /path/to/CrubKey   # project root (where Makefile and scripts/ live)
make dev
# or: ./scripts/dev.sh
```

Requires Docker (for Postgres). Backend runs on **http://127.0.0.1:5001**, frontend on **http://127.0.0.1:3000**. Ctrl+C stops the frontend (and the script stops the backend).

**Seed + create ticket + print guest URL (backend must be running):**

```bash
make demo
# or: python3 scripts/demo.py
```

Prints the guest URL; open it in the browser to see the guest page.

---

## Run locally (manual)

**1. Backend (Flask + Postgres)**

```bash
cd backend
# Set FLASK_APP=wsgi:app and DATABASE URL in .env; create DB and run migrations
flask db upgrade
flask run --port 5001
```

**2. Seed the app (once)**

```bash
curl -s -X POST http://127.0.0.1:5001/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@curbkey.com","password":"admin123"}'
```

**3. Frontend (Next.js)**

```bash
cd frontend
# Create .env.local with: NEXT_PUBLIC_API_BASE=http://127.0.0.1:5001
npm install
npm run dev
```

Open **http://127.0.0.1:3000**.

---

## Deploy (public demo for CV)

**Frontend:** Vercel · **Backend:** Render / Fly / Railway · **DB:** Neon / Supabase / Render

Health checks (`GET /healthz`), env vars, and CORS are set.

- **Step-by-step (Vercel + Render + Supabase):** [docs/DEPLOY_TODAY.md](docs/DEPLOY_TODAY.md) — do this first.
- Full reference: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- **Vercel:** Set `NEXT_PUBLIC_API_BASE` to your backend URL.
- **Backend:** Set `DATABASE_URL`, `JWT_SECRET_KEY`, `CORS_ORIGINS` (your Vercel URL). Health check path: `/healthz`.
- Optional: [render.yaml](render.yaml) for Render one-click deploy.

---

**4. Worker (optional — scheduler + notifications)**

For production, run a worker that ticks the scheduler and drains the notification outbox on a loop (no button needed):

```bash
make worker
# or: cd backend && flask worker
```

Env (optional): `WORKER_TICK_INTERVAL_SECONDS=60`, `WORKER_DRAIN_INTERVAL_SECONDS=30`, `WORKER_DRAIN_LIMIT=50`. On Render/Heroku, run this as a separate worker process.

---

## Demo in 90 seconds

1. **Seed demo** — Manager console → **Seed Demo** (venue + exits + zones + valet).
2. **Create ticket** — Manager → **Create Ticket** → **Copy Guest Link**.
3. **Open guest** — Paste or open the guest link; pick exit, click **Request now** (or **In 1 min**).
4. **Scheduler tick** — Manager → **Scheduler tick** (or run `./scripts/tick-scheduler.sh` with a manager JWT so SCHEDULED → REQUESTED).
5. **Valet** — Open **Valet console**, sign in `admin@curbkey.com` / `admin123`, use **Active** tab and **Retrieving** / **Ready** / **Picked Up**.

**Login:** `admin@curbkey.com` / `admin123`

Full walkthrough: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Architecture and flows: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Tests

From project root:

```bash
make test
# or: cd backend && DATABASE_URL=sqlite:///:memory: python -m pytest tests/ -v
```

Uses in-memory SQLite (no Postgres required). Covers: create SCHEDULED request, idempotent second request, valet cannot reset demo, guest cannot call protected endpoints. Scheduler tick tests (tick flips once, second tick no-op) are skipped on SQLite (they use `FOR UPDATE SKIP LOCKED`); run with Postgres for full coverage.

**CI (GitHub Actions):** On push/PR to `main` or `master`, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the full suite against Postgres (all 6 tests, including scheduler tick). No config needed beyond pushing to GitHub.

**New to testing?** Read [docs/TESTING_101.md](docs/TESTING_101.md) — a short, beginner-friendly guide (what tests are, why we have them, how to run and read them).

---

## Repo layout

```
CrubKey/
├── Makefile          # make dev, make demo
├── backend/          # Flask API, Postgres, migrations
├── frontend/         # Next.js (guest, valet, manager)
├── scripts/          # dev.sh, demo.py, sample_run.py, tick-scheduler.sh
├── docs/             # DEMO_SCRIPT.md, ARCHITECTURE.md, SPEC.md
├── infra/            # docker-compose (Postgres)
└── README.md
```

---

## Tech stack

- **Backend:** Python 3, Flask, SQLAlchemy, Flask-JWT-Extended, Postgres.
- **Frontend:** Next.js, React, Tailwind.
- **Patterns:** Outbox for notifications (drain + retry), scheduler tick for SCHEDULED→REQUESTED, one active request per ticket (idempotent).
