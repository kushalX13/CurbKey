#!/usr/bin/env bash
# Dev loop: tick the scheduler every 2s so SCHEDULED requests become REQUESTED when due.
# Requires a manager JWT. Usage:
#   export CURBKEY_JWT="<your-manager-token>"
#   ./scripts/tick-scheduler.sh
# Or: ./scripts/tick-scheduler.sh "<JWT>"
# API base defaults to http://127.0.0.1:5001; override with CURBKEY_API_URL.

set -e
JWT="${CURBKEY_JWT:-$1}"
BASE="${CURBKEY_API_URL:-http://127.0.0.1:5001}"
if [ -z "$JWT" ]; then
  echo "Usage: CURBKEY_JWT=<manager-token> $0  OR  $0 <JWT>"
  exit 1
fi
echo "Ticking scheduler every 2s at $BASE (Ctrl+C to stop)"
while true; do
  curl -s -X POST "$BASE/api/scheduler/tick" \
    -H "Authorization: Bearer $JWT" > /dev/null
  sleep 2
done
