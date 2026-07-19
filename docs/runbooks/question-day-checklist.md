# Question-day checklist

Pre-flight and on-call checks for the daily question's open → lock → reveal cycle (§6.2). See
[`launch-drill.md`](launch-drill.md) for the full launch runbook and dress-rehearsal procedure
this checklist is the day-to-day distillation of.

## The day before

- Curate tomorrow's daily question via `/admin/curate` (§15.2): market, headline, side labels,
  blurb, times (defaults 09:00/12:00/20:00 ET), `is_volatile` + `event_start_at` for anything
  tied to a live event. Confirm the row lands `status='scheduled'`.
- **Do not stop there — confirm the lifecycle jobs actually got scheduled.** As of this writing,
  curating a question does **not** automatically enqueue `question:open`/`question:lock`/
  `reveal:fire` — see `launch-drill.md`'s "STOP" section for the full finding. Check:
  ```bash
  DATABASE_URL=... apps/worker/scripts/question-zero-drill/check-scheduled-jobs.sh <questionId>
  ```
  Expect 3 rows. If you get 0 (and this gap hasn't been fixed yet), run
  `apps/worker/scripts/question-zero-drill/manual-schedule.mjs <questionId> <openAt> <lockAt> <revealAt>`
  to schedule them yourself — **do not skip this step or the question will silently never open**.
  Once the composer is fixed to schedule these itself, delete this bullet and just confirm the
  3 rows exist without needing to add them by hand.

## Around `open_at` / `lock_at` / `reveal_at`

- Watch the ops dashboard's (`/admin/ops`, §15.5) job health panel — every job in
  `apps/worker/src/registry.ts`'s `JOB_REGISTRY` should show a recent heartbeat
  (`job_heartbeats`). A stale `question:lock`/`reveal:fire` heartbeat right around its scheduled
  time means the worker is down or stuck — see the worker-kill-at-lock recovery exercise in
  `launch-drill.md` §2 for what to expect and confirm on recovery (crowd snapshot from the picks
  actually placed; lock price from cache/DB/nearest-snapshot per the staleness ladder, §6.2 step
  4 — never silently null, never silently stale).
- Venue adapter status on the same dashboard: `venue_degraded:{venue}` means prices are serving
  from cache/DB fallback. Expected briefly on a real hiccup; if it's still degraded heading into
  a lock, see [`venue-outage.md`](venue-outage.md).
- Today's question status timeline on `/admin/ops` reads the same effective-state logic the
  public API does (§5.7) — a question whose `lock_at` has passed presents as locked even before
  the `question:lock` job has actually run. That's by design (worker-outage tolerance), not a
  sign anything is wrong by itself — cross-check the job-health panel, not just the status
  column, before concluding something's actually stuck.

## If `reveal:fire` misses its window

See the overdue-reveal banner on `/admin/ops` and [`settlement-dispute.md`](settlement-dispute.md).
Note `reveal:fire` self-re-arms every `REVEAL_REARM_MIN` (30min) until the question is settled —
a single missed window isn't itself an incident if settlement is just running late; it becomes
one past `REVEAL_MAX_DELAY_H` (12h), which is the alert threshold to actually page on.
