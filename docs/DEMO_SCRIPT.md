# CurbKey — 90-second demo walkthrough

Run this end-to-end in about 90 seconds. You’ll see: seed → create ticket → open guest → request car → scheduler tick → valet/manager views.

---

## Prerequisites

- Python 3, Node 18+, PostgreSQL
- Backend env: `FLASK_APP=wsgi:app`, DB URL in `.env`

---

## 1. Start backend (5 s)

```bash
cd backend
flask run --port 5001
```

Leave running. You should see: `Running on http://127.0.0.1:5001`.

---

## 2. Seed the app (10 s)

In a **new terminal**:

```bash
curl -s -X POST http://127.0.0.1:5001/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@curbkey.com","password":"admin123"}'
```

Expect: `"message": "seeded"` or `"already seeded"`.

---

## 3. Start frontend (10 s)

In a **new terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:3000** — you should see the CurbKey home (Customer / Valet / Manager).

---

## 4. Create ticket + open guest (15 s)

1. On the home page, click **Valet console** or **Manager console**.
2. Sign in: **admin@curbkey.com** / **admin123**.
3. Go to **Manager** (if you landed on Valet).
4. In **Demo Kit**, click **Seed Demo** (creates venue + exits + zones + valet).
5. Click **Create Ticket**.
6. Click **Copy Guest Link** (or open the link shown) — guest page opens in a new tab.

---

## 5. Request car (10 s)

On the **guest page**:

1. Pick an exit from the dropdown.
2. Click **Request now** (or **In 1 min** to test scheduling).
3. Confirm status shows **REQUESTED** (or **SCHEDULED** if you chose “In 1 min”).

---

## 6. Scheduler tick (10 s)

Back on the **Manager** tab:

1. Click **Scheduler tick** (or run the tick script in a terminal so SCHEDULED → REQUESTED over time).
2. If you had a SCHEDULED request, run tick until it flips to REQUESTED.

Optional — run tick every 2 s in a terminal (get JWT from login first):

```bash
export CURBKEY_JWT="<paste JWT from /auth/login>"
./scripts/tick-scheduler.sh
```

---

## 7. Valet + Manager (20 s)

- **Valet** (http://127.0.0.1:3000/valet): See **Active** requests; use **Retrieving** → **Ready** → **Picked Up**.
- **Manager** (http://127.0.0.1:3000/manager): **Drain notifications**, **Reset Demo**, **Active** / **History** tabs.

---

## Quick reference

| Step        | Action              | Where / Command                    |
|------------|---------------------|------------------------------------|
| Backend    | Start API           | `cd backend && flask run --port 5001` |
| Seed       | Create admin/venue  | `POST /auth/seed` or Manager **Seed Demo** |
| Frontend   | Start UI            | `cd frontend && npm run dev`       |
| Ticket     | Create + guest link | Manager **Create Ticket** → **Copy Guest Link** |
| Guest      | Request car         | Guest page **Request now** / **In 1 min** |
| Scheduler  | SCHEDULED → REQUESTED | Manager **Scheduler tick** or `scripts/tick-scheduler.sh` |
| Valet      | Update status       | Valet **Active** → Retrieving / Ready / Picked Up |

**Login:** `admin@curbkey.com` / `admin123`

---

## One-shot script (optional)

From project root, with backend already running:

```bash
python3 scripts/sample_run.py
```

Prints guest URL at the end. Use `python3 scripts/sample_run.py --wait` to see SCHEDULED → REQUESTED in the same run (~65 s wait).
