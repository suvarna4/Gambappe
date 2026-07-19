#!/usr/bin/env bash
# Question Zero drill, step 3: check whether curating a question actually scheduled its
# lifecycle jobs. As documented in docs/runbooks/launch-drill.md's "Known gap" callout, this
# currently prints ZERO rows for a freshly-curated daily question — POST /api/admin/questions
# never calls scheduleQuestionLifecycle(). Re-run this on every future drill: it should start
# printing 3 rows (question:open, question:lock, reveal:fire) once that gap is fixed, and it's
# how you'd notice a regression if the gap ever comes back.
#
# Usage: DATABASE_URL=... ./scripts/question-zero-drill/check-scheduled-jobs.sh <questionId>
set -euo pipefail

QUESTION_ID="${1:?usage: check-scheduled-jobs.sh <questionId>}"
: "${DATABASE_URL:?set DATABASE_URL to your drill database}"

psql "$DATABASE_URL" -c \
  "select name, state, created_on, start_after from pgboss.job where data::text like '%${QUESTION_ID}%' order by created_on;"
