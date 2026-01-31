# CurbKey demo — baby steps

Run everything locally first. Deploy to Vercel later (frontend only; backend needs a host with Postgres).

---

## 1. Start the backend

```bash
cd CrubKey/backend
flask run --port 5001
```

Leave this running. You should see: `Running on http://127.0.0.1:5001`.

---

## 2. Seed the app (once)

In another terminal:

```bash
curl -s -X POST http://127.0.0.1:5001/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@curbkey.com","password":"admin123"}'
```

You should see `"message": "seeded"` or `"already seeded"`.

---

## 3. Start the frontend

In another terminal:

```bash
cd CrubKey/frontend
npm run dev
```

Open **http://127.0.0.1:3000** in your browser. You should see the CurbKey home page with three sections: **Customer**, **Valet**, **Manager**.

---

## 4. Get a customer (guest) ticket URL

**Easiest:** Sign in as manager (see step 6), then on the home page click **Open sample ticket**. That creates a new ticket and opens the guest page.

**Or:**

**A) Run the sample script** (from project root):

```bash
cd CrubKey
python3 scripts/sample_run.py
```

At the end it prints: `Done. Guest page (if frontend on 3000): http://127.0.0.1:3000/t/XXXXX`

**B) Create a ticket manually:**

```bash
curl -s -X POST http://127.0.0.1:5001/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"venue_id":1}'
```

Use the `guest_path` from the response, e.g. `http://127.0.0.1:3000/t/TOKEN_HERE`.

---

## 5. Open the customer (guest) page

After clicking **Open sample ticket** (step 4), you’re on the guest page. Or paste a guest URL, e.g.:

**http://127.0.0.1:3000/t/w18gSTcFM0n5gL_WYf3-VQ**

You should see:

- Ticket ID
- **Status** (e.g. SCHEDULED or REQUESTED)
- **Request pickup exit** dropdown and **Request now** / **In 1 min** buttons

Use **Request now** for immediate request, or **In 1 min** to schedule 1 minute ahead.

---

## 6. Open the Valet page

1. Go to **http://127.0.0.1:3000**
2. Click **Valet console →**
3. You’ll be asked to sign in. Use:
   - **Email:** `admin@curbkey.com`
   - **Password:** `admin123`
4. After login you’ll see the **Valet console**: list of requests, Venue ID, and buttons **Retrieving** / **Ready** / **Picked Up** per request.
5. Click **Open guest** on a request to open that customer’s ticket page.

---

## 7. Open the Manager page

1. Go to **http://127.0.0.1:3000**
2. Click **Manager console →**
3. Sign in with the same credentials: `admin@curbkey.com` / `admin123`
4. You’ll see:
   - **Scheduler tick** — run this to turn due SCHEDULED requests into REQUESTED (or run the tick script every 2s in a terminal).
   - **Drain notifications** — send any pending notifications (STUB logs them).
   - **All requests** — list of every request.

---

## Quick recap

| Page        | URL                          | Purpose                          |
|------------|------------------------------|----------------------------------|
| Home       | http://127.0.0.1:3000        | Links to Customer / Valet / Manager |
| Customer   | http://127.0.0.1:3000/t/TOKEN | Guest: see status, request car, schedule |
| Valet      | http://127.0.0.1:3000/valet  | Staff: list requests, set Retrieving / Ready / Picked up (login required) |
| Manager    | http://127.0.0.1:3000/manager | Ops: scheduler tick, drain notifs, all requests (login required) |

**Default login:** `admin@curbkey.com` / `admin123` (after seed).

---

## Deploying to Vercel

- Deploy the **frontend** (Next.js) to Vercel. Set `NEXT_PUBLIC_API_BASE` to your **backend** URL (e.g. Railway, Render, Fly.io — the backend needs Postgres and must be deployed separately).
- The backend is Flask + Postgres; it does not run on Vercel. Use a service that supports Python + Postgres (e.g. Railway, Render, Fly.io).
