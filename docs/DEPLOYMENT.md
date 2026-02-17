# Deploy CurbKey (public demo)

Deploy frontend on Vercel, backend on Render, and Postgres on Neon or Supabase. Health checks and CORS are set for production.

---

## Quick deploy (Vercel + Render + Supabase)

Do these steps in order. You need: Vercel, Render, and Supabase accounts; repo on GitHub.

### 1. Database (Supabase)

1. [supabase.com](https://supabase.com) → New project → name, password, region → Create.
2. Settings → Database → Connection string → **URI**.
3. Copy the URI and replace `[YOUR-PASSWORD]` with your DB password. Save as `DATABASE_URL` for the backend.

### 2. Backend (Render)

1. [render.com](https://render.com) → New → Web Service → connect repo.
2. **Build:** `pip install -r backend/requirements.txt && cd backend && flask db upgrade`
3. **Start:** `cd backend && gunicorn --bind 0.0.0.0:$PORT wsgi:app`
4. **Env:** `DATABASE_URL` (Supabase URI), `JWT_SECRET_KEY` (e.g. `openssl rand -hex 32`), `FLASK_APP` = `wsgi:app`. Leave `CORS_ORIGINS` for step 4.
5. **Health check path:** `/healthz`
6. Deploy. Note backend URL (e.g. `https://curbkey-api.onrender.com`).

**Gunicorn:** Add `gunicorn>=21.0` to `backend/requirements.txt` if missing.

### 3. Frontend (Vercel)

1. [vercel.com](https://vercel.com) → Import repo.
2. **Root Directory:** `frontend`
3. **Env:** `NEXT_PUBLIC_API_BASE` = backend URL (no trailing slash).
4. Deploy. Note frontend URL (e.g. `https://curbkey-xxx.vercel.app`).

### 4. CORS (Render)

1. Render → your backend service → Environment.
2. Add `CORS_ORIGINS` = your Vercel URL (no trailing slash). Redeploy.

### 5. Seed (once)

```bash
curl -X POST https://YOUR-BACKEND-URL/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@curbkey.com","password":"admin123"}'
```

Then open the Vercel URL → Login → Manager → Seed Demo → Create Ticket → Copy Guest Link.  
**Login:** `admin@curbkey.com` / `admin123`

---

## Reference

**Architecture:** Vercel (frontend) → Render (backend) → Neon/Supabase/Render (Postgres).

**Backend env**

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | Yes | `postgresql://...` from Neon/Supabase/Render |
| `JWT_SECRET_KEY` | Yes | Long random string |
| `CORS_ORIGINS` | Yes (prod) | Vercel URL, comma-separated, no trailing slash |
| `FLASK_APP` | Yes | `wsgi:app` |

**Frontend env**

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_API_BASE` | Backend URL, no trailing slash |

**Health:** `GET /healthz` → `{"status":"ok","db":"ok"}`. Set Health Check Path to `/healthz` on Render.

**Worker (optional):** Render Background Worker, same repo, start: `cd backend && flask worker`. Same env (no CORS needed). Runs scheduler tick and notification drain on an interval.

**Alternatives:** Neon instead of Supabase for DB. Fly.io or Railway instead of Render for backend; set `DATABASE_URL`, `JWT_SECRET_KEY`, `CORS_ORIGINS`, health path `/healthz`.
