# Question Zero drill scripts

Companion scripts for `docs/runbooks/launch-drill.md`'s "Question Zero" dress rehearsal
(design doc WS14-T4, §19: "Runbooks + full dress rehearsal ... curate → open → lock → settle
via mock → reveal → cards, including a worker-kill-at-lock recovery exercise"). The runbook is
the source of truth for *when*/*why* to run each step; this directory is the *how* — the exact
commands, kept runnable so the drill is a repeatable exercise, not a one-time narrative.

None of these scripts are wired into CI or `pnpm verify` — they're an ops/on-call tool, run by
hand against a disposable database, the same way `apps/web/load-tests/seed.ts` (WS14-T2) is.
**Never point `DATABASE_URL` at a shared dev or prod database when running these** — they
insert fixture rows with fixed IDs and enqueue real pg-boss jobs.

The `.mjs` scripts live under `apps/worker/` (not repo-root `scripts/`) so plain Node ESM
import resolution finds `@receipts/db` / `@receipts/venues` / `pg-boss` via this app's own
`node_modules` — **run them with `apps/worker` as your cwd**:

```bash
cd apps/worker
node scripts/question-zero-drill/seed-market.mjs
```

## Prerequisites

- A disposable Postgres database, migrated: see the runbook's "Environment setup" section for
  the exact `createdb` / `db:migrate` sequence.
- The web app (`pnpm --filter web dev`) and worker (`pnpm --filter worker dev`) running against
  that same `DATABASE_URL` + an isolated `REDIS_URL` db index.
- `ADMIN_STOPGAP_TOKEN` / `ADMIN_STOPGAP_IP_ALLOWLIST=127.0.0.1,::1` set for the web process (the
  curate step calls the real admin HTTP API).
- The workspace packages built (`pnpm --filter @receipts/db --filter @receipts/venues build`) —
  these scripts import the compiled `dist/` output, same as the apps do.

## Scripts, in drill order

1. `seed-market.mjs` — inserts one `markets` row (what `venue:sync-catalog` would have
   produced), so the composer has something to curate against without needing real venue
   credentials.
2. `curate.sh` — curates the daily question via the real `POST /api/admin/questions` HTTP
   endpoint, with `open_at`/`lock_at`/`reveal_at` a few minutes apart (not the real 09:00/12:00/
   20:00 ET defaults) so the drill runs in minutes.
3. `check-scheduled-jobs.sh` — queries `pgboss.job` for anything referencing the curated
   question. **As of this writing this prints zero rows** — see the "Known gap" callout in the
   runbook: the composer does not enqueue the lifecycle jobs. Run this for real on every future
   drill; it should start printing 3 rows once that gap is fixed, and this script is how you'd
   notice a regression if it ever comes back.
4. `manual-schedule.mjs <questionId> <openAt> <lockAt> <revealAt>` — enqueues
   `question:open`/`question:lock`/`reveal:fire` exactly like
   `apps/worker/src/jobs/question-lifecycle.ts`'s `scheduleQuestionLifecycle()` does. This is
   the drill's workaround for step 3's finding — delete this step from the drill once the
   composer schedules these itself.
5. `seed-lock-snapshot.mjs <marketId> <lockAtIso> <price>` — (optional) seeds a
   `market_price_snapshots` row at `lock_at`, so a worker-kill-at-lock exercise has a concrete,
   distinct price to prove the late-fire backfill actually reads (§5.7).
6. `settle-via-mock.mjs <questionId> <yes|no>` — grades the locked question exactly the way
   `settlement:poll` would once its adapter reports `resolved`, without needing a live venue —
   calls the same `gradeResolvedQuestionTx` repository function production settlement uses, then
   enqueues `grade:followup` for the live worker to pick up. (The drill itself was originally run
   against the real `runSettlementPoll` with an injected `MockVenueAdapter` for maximum fidelity
   — see the runbook's timing log; this script is the simplified, safely-committable equivalent
   for repeat runs.)

The worker-kill-at-lock exercise itself (kill the worker process, wait past `lock_at`, diff the
API's effective-state presentation against the raw DB row, restart the worker) and the rollback
exercise (`PATCH /api/admin/questions/:id/void`) are plain shell/curl, documented directly in
the runbook rather than scripted — see "Steps" there.
