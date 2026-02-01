# Deploy CurbKey today (Vercel + Render + Supabase)

Use this as a **linear checklist**. Do the steps in order. You need: Vercel account, Render account, Supabase account, and this repo pushed to GitHub.

---

## Step 1 — Database (Supabase) — ~5 min

1. Go to **[supabase.com](https://supabase.com)** → sign in → **New project**.
2. Pick org, name (e.g. `curbkey`), database password (save it), region → **Create project**.
3. Wait for the project to be ready.
4. In the left sidebar: **Settings** (gear) → **Database**.
5. Under **Connection string**, choose **URI**.
6. Copy the URI. It looks like:
   ```text
   postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
7. Replace `[YOUR-PASSWORD]` with the database password you set. **Save this full URL** — you’ll paste it into Render as `DATABASE_URL`.

---

## Step 2 — Backend (Render) — ~10 min

1. Go to **[render.com](https://render.com)** → sign in → **New +** → **Web Service**.
2. **Connect your repo** (GitHub): select the CurbKey repo. If you don’t see it, connect the right GitHub account.
3. Use these settings:

   | Field | Value |
   |-------|--------|
   | **Name** | `curbkey-api` (or any name) |
   | **Region** | Pick one close to you |
   | **Runtime** | Python |
   | **Build Command** | `pip install -r backend/requirements.txt && cd backend && flask db upgrade` |
   | **Start Command** | `cd backend && gunicorn --bind 0.0.0.0:$PORT wsgi:app` |

4. **Environment variables** — click **Add Environment Variable** and add:

   | Key | Value |
   |-----|--------|
   | `DATABASE_URL` | The full Supabase URI from Step 1 (with password replaced) |
   | `JWT_SECRET_KEY` | A long random string. Generate one: run in terminal `openssl rand -hex 32` and paste the result |
   | `FLASK_APP` | `wsgi:app` |

   Do **not** add `CORS_ORIGINS` yet — you’ll add it after you have the Vercel URL (Step 4).

5. **Health Check** (under “Health Check Path” or “Advanced”): set to **`/healthz`**.
6. **Create Web Service**. Render will build and deploy. Wait until the deploy turns green (Live).
7. Open your service URL (e.g. `https://curbkey-api.onrender.com`). You should see:
   ```json
   {"message":"CurbKey backend is running","health":"/healthz"}
   ```
8. Open `https://YOUR-SERVICE-URL/healthz`. You should see `{"status":"ok","db":"ok"}`.
9. **Copy and save your backend URL** (no trailing slash), e.g. `https://curbkey-api.onrender.com`. You’ll need it for Vercel and for CORS.

---

## Step 3 — Frontend (Vercel) — ~5 min

1. Go to **[vercel.com](https://vercel.com)** → sign in → **Add New…** → **Project**.
2. Import your **CurbKey** repo from GitHub. Select the repo.
3. **Configure:**
   - **Framework Preset:** Next.js (should be auto-detected).
   - **Root Directory:** set to **`frontend`** (the Next.js app is in the `frontend/` folder).
4. **Environment Variables** — add:

   | Name | Value |
   |------|--------|
   | `NEXT_PUBLIC_API_BASE` | Your Render backend URL from Step 2 (no trailing slash), e.g. `https://curbkey-api.onrender.com` |

5. **Deploy**. Wait until the build finishes.
6. Open the Vercel URL (e.g. `https://curbkey-xyz.vercel.app`). The app will load but **API calls will fail until you set CORS** in the next step. **Copy and save this frontend URL.**

---

## Step 4 — Set CORS on Render — ~2 min

1. In **Render** → your **curbkey-api** service → **Environment**.
2. Add:

   | Key | Value |
   |----|--------|
   | `CORS_ORIGINS` | Your Vercel URL from Step 3 (no trailing slash), e.g. `https://curbkey-xyz.vercel.app` |

3. **Save Changes**. Render will redeploy (1–2 min).
4. After redeploy, open your **Vercel** app again. Login and API calls should work.

---

## Step 5 — Seed the app (one-time) — ~2 min

You need one venue and one manager user. Do this **once** after the backend is live.

**Option A — curl (replace URLs with yours):**

```bash
curl -X POST https://YOUR-BACKEND-URL.onrender.com/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@curbkey.com","password":"admin123"}'
```

You should get a JSON response with `"message":"seeded"` and venue/user info.

**Option B — From the app:**

1. Open your **Vercel** frontend URL.
2. Go to **Manager** (or **Login** → sign in when you have a user).
3. You can’t log in until you’ve seeded. So use **Option A** first, then:
4. Login with **admin@curbkey.com** / **admin123**.
5. In Manager, click **Seed Demo** (creates exits/zones/valet for demo).
6. Click **Create Ticket** → **Copy Guest Link**.
7. Open the guest link in another tab — you’re done.

**Default login after seed:** `admin@curbkey.com` / `admin123`

---

## Checklist summary

- [ ] **Step 1** — Supabase: project created, connection URI copied (password replaced).
- [ ] **Step 2** — Render: Web Service created, `DATABASE_URL`, `JWT_SECRET_KEY`, `FLASK_APP` set, health path `/healthz`, deploy green, `/healthz` returns `db: ok`.
- [ ] **Step 3** — Vercel: project created, `NEXT_PUBLIC_API_BASE` = Render URL, deploy done, frontend URL copied.
- [ ] **Step 4** — Render: `CORS_ORIGINS` = Vercel URL, redeploy done.
- [ ] **Step 5** — Seed: `POST /auth/seed` (curl or from app), then login and run demo (Seed Demo → Create Ticket → Copy Guest Link).

---

## If Vercel build fails (root directory)

If Vercel doesn’t detect the Next.js app (e.g. repo root has `frontend/`):

- In Vercel project **Settings** → **General** → **Root Directory** → set to **`frontend`**.
- Redeploy.

---

## If you see 404 NOT_FOUND (white / blank page) on Vercel

The deployment is “Ready” but visiting your Vercel URL shows **404: NOT_FOUND**. That usually means the app was not built from the `frontend` folder.

1. In **Vercel** → your project (**curb-key**) → **Settings** → **General**.
2. Under **Root Directory**, click **Edit**.
3. Set the value to exactly **`frontend`** (no leading slash, no trailing slash). Leave “Include files outside the root directory” as you like.
4. Click **Save**.
5. Go to **Deployments** → open the **⋯** menu on the latest deployment → **Redeploy** (or push a new commit to `main`).

After the new deploy finishes, open your production URL again (e.g. `https://curb-key.vercel.app`). The home page should load instead of 404.

---

## Optional — Worker (scheduler + notifications)

To run “Scheduler tick” and “Drain notifications” automatically (so you don’t have to click in Manager):

1. In Render: **New +** → **Background Worker**.
2. Same repo, same env vars as the web service (you can skip `CORS_ORIGINS`).
3. **Start Command:** `cd backend && flask worker`
4. Deploy. It will tick and drain on an interval.

You can skip this and still use the app; use the **Scheduler tick** and **Drain notifications** buttons on the Manager page when needed.
