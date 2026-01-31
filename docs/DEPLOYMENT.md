# Deployment plan — public demo (CV credibility)

Deploy CurbKey so you have a **public demo link**: frontend on Vercel, backend on a free host, Postgres on a free DB. Health checks, env vars, and CORS are set for production.

---

## Architecture

```
[Vercel]     Frontend (Next.js)  →  [Render / Fly / Railway]  Backend (Flask)
                                                                    ↓
[Browser]   NEXT_PUBLIC_API_BASE  →  CORS_ORIGINS, healthz     [Neon / Supabase / Render]  Postgres
```

- **Frontend:** Vercel (free tier, automatic HTTPS).
- **Backend:** Render free web service, or Fly.io / Railway (free tiers; Railway has limited credits).
- **Database:** Neon or Supabase (free Postgres), or Render Postgres (free with spin-down).
- **Worker (optional):** Render background worker running `flask worker`, or cron hitting your API.

---

## 1. Database (pick one)

### Neon (recommended — free, no spin-down)

1. [neon.tech](https://neon.tech) → Sign up → Create project.
2. Copy the **connection string** (e.g. `postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`).
3. Use this as `DATABASE_URL` for the backend.

### Supabase

1. [supabase.com](https://supabase.com) → New project.
2. Settings → Database → Connection string (URI, session mode).
3. Use as `DATABASE_URL`.

### Render Postgres

1. Render Dashboard → New → PostgreSQL.
2. Copy **Internal Database URL** (for a backend on Render) or **External** (for Fly/Railway).
3. Use as `DATABASE_URL`.

---

## 2. Backend (Render free web service)

1. [render.com](https://render.com) → New → Web Service.
2. Connect your repo; root = repo root.
3. **Build:**
   - Build command: `pip install -r backend/requirements.txt && cd backend && flask db upgrade`
   - Start command: `cd backend && gunicorn wsgi:app` (or `flask run` for dev; add `gunicorn` to `requirements.txt`).
4. **Environment:**

   | Variable | Value | Required |
   |----------|--------|----------|
   | `DATABASE_URL` | Postgres URL from Neon/Supabase/Render | Yes |
   | `JWT_SECRET_KEY` | Random secret (e.g. `openssl rand -hex 32`) | Yes |
   | `FLASK_APP` | `wsgi:app` | Yes (if not in start command) |
   | `CORS_ORIGINS` | Your Vercel URL, e.g. `https://curbkey.vercel.app` | Yes (production) |

5. **Health check:** Render uses the root URL; set **Health Check Path** to `/healthz` so it hits the DB check (`GET /healthz` → 200 + `{"status":"ok","db":"ok"}`).
6. Deploy. Note the backend URL (e.g. `https://curbkey-api.onrender.com`).

**Optional — worker on Render:** New → Background Worker; same repo; Start command: `cd backend && flask worker`. Same env vars (no `CORS_ORIGINS` needed for worker).

**Alternative (Fly.io):** `fly launch` in repo root; add a `Dockerfile` for the backend or use a buildpack. Set `DATABASE_URL`, `JWT_SECRET_KEY`, `CORS_ORIGINS`. Health check: `fly scale show` and use `/healthz`.

**Alternative (Railway):** New project from repo; add Postgres or use external DB. Set env vars; health check path `/healthz`.

---

## 3. Frontend (Vercel)

1. [vercel.com](https://vercel.com) → Import your repo (Next.js detected).
2. **Environment variable:**

   | Variable | Value |
   |----------|--------|
   | `NEXT_PUBLIC_API_BASE` | Backend URL with no trailing slash, e.g. `https://curbkey-api.onrender.com` |

3. Deploy. Vercel gives you a URL (e.g. `https://curbkey-xxx.vercel.app`).

4. **Then:** Set that exact URL in the backend’s `CORS_ORIGINS` (and redeploy backend if you didn’t set it before). Use a single origin or comma-separated list, e.g. `https://curbkey-xxx.vercel.app,https://curbkey.com`.

---

## 4. Health checks

| Endpoint | Purpose |
|----------|--------|
| `GET /` | Root; returns `{"message":"CurbKey backend is running","health":"/healthz"}`. |
| `GET /healthz` | Liveness + DB: `SELECT 1`; returns `{"status":"ok","db":"ok"}` or 500 if DB fails. |

Use **Health Check Path** = `/healthz` on Render/Fly/Railway so the platform pings the DB and restarts if needed.

---

## 5. Env vars summary

**Backend (Render/Fly/Railway)**

| Env | Example | Notes |
|-----|---------|--------|
| `DATABASE_URL` | `postgresql://...` | From Neon/Supabase/Render Postgres. |
| `JWT_SECRET_KEY` | `your-secret` | Use a long random value in production. |
| `CORS_ORIGINS` | `https://curbkey.vercel.app` | Comma-separated; no trailing slash. |
| `FLASK_APP` | `wsgi:app` | If not in start command. |

**Frontend (Vercel)**

| Env | Example |
|-----|--------|
| `NEXT_PUBLIC_API_BASE` | `https://curbkey-api.onrender.com` |

**Worker (optional)**  
Same as backend; no `CORS_ORIGINS` needed. Optionally: `WORKER_TICK_INTERVAL_SECONDS`, `WORKER_DRAIN_INTERVAL_SECONDS`.

---

## 6. CORS

- **Development:** If `CORS_ORIGINS` is unset, the backend allows all origins (`*`).
- **Production:** Set `CORS_ORIGINS` to your Vercel (and custom domain) URL(s), comma-separated. Only those origins can call the API from the browser.

---

## 7. Post-deploy checklist

1. Backend health: open `https://your-backend.onrender.com/healthz` → `{"status":"ok","db":"ok"}`.
2. Seed once: `POST /auth/seed` with body `{"email":"admin@curbkey.com","password":"admin123"}` (e.g. via curl or Postman).
3. Frontend: open your Vercel URL; log in as manager; Seed Demo, Create Ticket, open guest link.
4. Worker (if you added it): scheduler tick and notification drain run on an interval; no button needed.

---

## 8. Gunicorn (production WSGI)

Add to `backend/requirements.txt`:

```
gunicorn>=21.0
```

Start command on Render: `cd backend && gunicorn --bind 0.0.0.0:$PORT wsgi:app`. Render sets `PORT`; Fly/Railway often do too. If not, use a fixed port (e.g. 5000) or read from env.

---

## Quick reference

| Layer | Service | Free tier | Notes |
|-------|---------|-----------|--------|
| Frontend | Vercel | Yes | Set `NEXT_PUBLIC_API_BASE`. |
| Backend | Render | Yes (spins down after idle) | Health path `/healthz`; set `CORS_ORIGINS`. |
| Backend | Fly.io | Yes | Need Dockerfile or buildpack. |
| Backend | Railway | Credits then paid | Easy env + Postgres. |
| DB | Neon | Yes | Good default; no spin-down. |
| DB | Supabase | Yes | Postgres + extras. |
| DB | Render Postgres | Yes | Spins down with free web. |

Once deployed, use your Vercel URL as the **public demo link** for your CV.
