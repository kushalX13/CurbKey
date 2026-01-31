# CurbKey — one-command dev and demo
# Run from project root: cd /path/to/CrubKey && make dev

.PHONY: dev demo db db-down test worker

# Start DB + backend + frontend (one command)
dev:
	@test -f scripts/dev.sh || (echo "Run from project root (directory containing scripts/)." && exit 1)
	./scripts/dev.sh

# Seed + create ticket + print guest URL (backend must be running)
demo:
	@python3 scripts/demo.py

# Start Postgres only (infra/docker-compose)
db:
	cd infra && docker-compose up -d

# Stop Postgres
db-down:
	cd infra && docker-compose down

# Run backend tests (from project root; uses SQLite, no Postgres required)
test:
	cd backend && DATABASE_URL=sqlite:///:memory: python -m pytest tests/ -v

# Run worker (scheduler tick + notification drain loop). DB must be up; set DATABASE_URL.
worker:
	cd backend && flask worker
