#!/usr/bin/env bash
# Question Zero drill, step 2: curate the daily question via the REAL admin HTTP API
# (POST /api/admin/questions, §15.2/WS10-T2) — open/lock/reveal a few minutes apart so the
# drill runs in minutes instead of waiting for the real 09:00/12:00/20:00 ET defaults.
#
# Usage: WEB_BASE=http://localhost:3100 ADMIN_TOKEN=... MARKET_ID=<from seed-market.mjs> \
#          ./scripts/question-zero-drill/curate.sh [open_offset_s] [lock_offset_s] [reveal_offset_s]
set -euo pipefail

BASE="${WEB_BASE:-http://localhost:3100}"
TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN to your drill ADMIN_STOPGAP_TOKEN}"
MARKET_ID="${MARKET_ID:?set MARKET_ID to the id printed by seed-market.mjs}"

OPEN_OFFSET_S="${1:--10}"
LOCK_OFFSET_S="${2:-240}"
REVEAL_OFFSET_S="${3:-360}"

NOW_S=$(date -u +%s)
OPEN_AT=$(date -u -d "@$((NOW_S + OPEN_OFFSET_S))" +"%Y-%m-%dT%H:%M:%S.000Z")
LOCK_AT=$(date -u -d "@$((NOW_S + LOCK_OFFSET_S))" +"%Y-%m-%dT%H:%M:%S.000Z")
REVEAL_AT=$(date -u -d "@$((NOW_S + REVEAL_OFFSET_S))" +"%Y-%m-%dT%H:%M:%S.000Z")
# Only one `daily` question per question_date (§5.3 partial unique index) — override with
# QUESTION_DATE=YYYY-MM-DD if you're re-running the drill more than once on the same day
# (a voided question still occupies its date, it doesn't free the slot).
QUESTION_DATE="${QUESTION_DATE:-$(date -u -d "@${NOW_S}" +"%Y-%m-%d")}"

echo "curating: open_at=$OPEN_AT lock_at=$LOCK_AT reveal_at=$REVEAL_AT" >&2

curl -sS -X POST "$BASE/api/admin/questions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Forwarded-For: 127.0.0.1" \
  -H "Content-Type: application/json" \
  -d "{
    \"market_id\": \"$MARKET_ID\",
    \"headline\": \"Will the Question Zero drill complete cleanly?\",
    \"blurb\": \"Launch-runbook dress rehearsal (WS14-T4).\",
    \"yes_label\": \"Yes\",
    \"no_label\": \"No\",
    \"question_date\": \"$QUESTION_DATE\",
    \"open_at\": \"$OPEN_AT\",
    \"lock_at\": \"$LOCK_AT\",
    \"reveal_at\": \"$REVEAL_AT\",
    \"is_volatile\": false
  }"
echo
