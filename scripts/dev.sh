#!/usr/bin/env bash
# One-command dev: start DB, backend, and frontend.
# Run from project root: make dev  or  ./scripts/dev.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://curbkey:curbkey@127.0.0.1:5432/curbkey}"
export FLASK_APP="${FLASK_APP:-wsgi:app}"

echo "==> Starting DB (infra/docker-compose)..."
(cd infra && docker-compose up -d)

echo "==> Installing backend deps..."
(cd backend && pip install -r requirements.txt -q)

echo "==> Waiting for Postgres..."
(cd backend && python3 -c "
import os, sys, time
import psycopg2
url = os.environ.get('DATABASE_URL', 'postgresql://curbkey:curbkey@127.0.0.1:5432/curbkey')
for i in range(30):
    try:
        psycopg2.connect(url).close()
        print(' ready.')
        sys.exit(0)
    except Exception:
        time.sleep(1)
print('Postgres did not become ready in 30s.', file=sys.stderr)
sys.exit(1)
") || exit 1

echo "==> Running migrations..."
(cd backend && flask db upgrade)

echo "==> Starting backend on http://127.0.0.1:5001 ..."
(cd backend && flask run --port 5001) &
BACKEND_PID=$!
sleep 3

echo "==> Starting frontend on http://127.0.0.1:3000 ..."
echo "    (Ctrl+C stops frontend; backend may keep running. Kill with: kill $BACKEND_PID)"
(cd frontend && npm run dev) || true
kill $BACKEND_PID 2>/dev/null || true
