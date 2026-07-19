# Launch runbook + Question Zero drill

WS14-T4 (design doc §19, §15.5, §18). This is the P0 launch gate: "Gate P0→launch: WS14-T2
thresholds + WS14-T4 drill complete" (§19.5). It covers two things:

1. **The launch runbook** — the operational sequence to take the product from a fresh
   environment to a live first question, plus what to watch during the first reveal and how to
   roll back.
2. **The Question Zero drill** — a full dress rehearsal of one question's entire lifecycle
   (curate → open → lock → settle → reveal → cards) executed for real against a local instance,
   including a worker-kill-at-lock recovery exercise (§5.7 effective-state rule). The dated
   evidence (timing log, findings) for the run backing this document lives in
   [`docs/audits/question-zero-drill-log.md`](../audits/question-zero-drill-log.md) — re-run the
   drill (steps below, or `apps/worker/scripts/question-zero-drill/`) before every real launch
   and before any change to the open/lock/settle/reveal jobs; don't rely on a stale log.

Original checklist this doc replaces (kept in spirit, expanded below): load test gates launch
(WS14-T2), ISR/CDN serves the spectator page, golden loop walked end-to-end, `/admin/ops` shows
every job healthy before opening traffic.

## STOP — known launch blocker (read before scheduling a real Question Zero)

**As shipped on `main` at the time of this drill, curating tomorrow's question via
`/admin/curate` does nothing operationally.** `POST /api/admin/questions`
(`apps/web/app/api/admin/questions/route.ts`, WS10-T2) inserts the question row
(`status='scheduled'`) but never calls `scheduleQuestionLifecycle`
(`apps/worker/src/jobs/question-lifecycle.ts`) — so `question:open`, `question:lock`, and
`reveal:fire` are never enqueued for it. A curated daily question sits in `status='scheduled'`
forever; it never opens, never locks, never reveals, with no error or alert anywhere (the ops
dashboard's job-health panel has nothing to show as broken — the problem is a job that was never
even created). The drill proved this empirically (see the linked evidence log) by curating a
real question and querying `pgboss.job` directly: zero rows.

**Do not run a real Question Zero until this is fixed.** The fix is small and well-scoped (wire
a call equivalent to `scheduleQuestionLifecycle` into the composer route, using the same
`getBoss()` pattern `apps/web/lib/wallet-queue.ts` already establishes for enqueueing pg-boss
jobs from `apps/web`) — flagged here rather than fixed in this PR (WS14-T4 is the drill/runbook
task, not a WS10-T2 patch); see the evidence log for the exact pointer.
`apps/worker/scripts/question-zero-drill/manual-schedule.mjs` is a stopgap that reproduces what
the composer should do, usable to keep curating questions manually until the real fix lands —
**do not treat that script as a substitute for the fix**; every curated question needs someone
to remember to run it, which does not scale past a single-operator dry run.

## 1. Environment setup

### 1.1 Env var checklist (Appendix B)

Every var in `.env.example` must be set before either app boots; both `apps/web` and
`apps/worker` read from the same `.env` shape (worker only needs the subset it touches — DB,
Redis, venue, and notification vars — but keeping one file for both avoids drift). P0-specific
ones worth calling out:

- `ADMIN_STOPGAP_TOKEN` + `ADMIN_STOPGAP_IP_ALLOWLIST` — both required or every `/admin/*`
  route 404s (fails closed by design, §19.5). The allowlist matches `X-Forwarded-For`/`X-Real-IP`
  headers, not the raw TCP peer — confirm your reverse proxy (or, for a local drill, your curl
  invocations) actually sets one of those.
- `GHOST_COOKIE_SECRET`, `WALLET_HASH_SECRET`, `SHARE_TOKEN_SECRET`, `UNSUB_TOKEN_SECRET`,
  `INTERNAL_API_SECRET` — all HMAC/signing keys; generate distinct strong random values per
  environment (staging secrets must never equal prod's). `GHOST_COOKIE_SECRET` is **effectively
  non-rotatable** in prod — rotating it logs out every ghost (no claimed-account recovery path
  for a ghost). Do not treat it as a routinely-rotated secret.
- `KALSHI_API_BASE` / `POLYMARKET_*_BASE` / `POLYGON_RPC_URL` — real venue endpoints in
  staging/prod. Pointing these at anything unreachable (as this drill deliberately does, to keep
  `venue:price-tick`/`settlement:poll` from making real network calls against drill fixtures)
  will make `venue:price-tick` fail every tick and set `venue_degraded:{venue}` — confirmed
  working as designed during this drill (see the evidence log's "bonus finding"), but don't
  mistake a misconfigured base URL for a real venue outage when reading `/admin/ops` on launch
  day.
- `NEXT_PUBLIC_APP_URL` — must be the real public origin in staging/prod; it's baked into OG
  image URLs and share links (`apps/web/lib/reveal-payload.ts`).
- `ADMIN_SEED_EMAIL` — dev/staging only; promotes that email to `role='admin'` on `db:seed`.
  Never set in prod (§15.1: admins are set only via seed/ops SQL, deliberately not exposed here).

### 1.2 Migration order

Standard, additive-only (§4.5) — the doc's own ordering, confirmed by running it:

```bash
# 1. Point DATABASE_URL at the target database (never a shared dev DB for this step's DDL).
# 2. Apply every migration (0001_init + any timestamped ones after it), in order:
pnpm --filter @receipts/db db:migrate
# 3. Seed baseline data (admin user via ADMIN_SEED_EMAIL, nemesis season, placement items):
pnpm --filter @receipts/db db:seed
```

Deploy ordering (§18): migrations run as a release step **before** web+worker roll. The
additive-only policy is what makes that order safe — an old worker/web binary talking to a
migrated-ahead schema never sees a column/table it expects removed out from under it.

### 1.3 First-question authoring & scheduling

Via `/admin/curate` (or `POST /api/admin/questions` directly): pick an already-synced market
(`venue:sync-catalog` runs hourly — give it at least one tick before curating, or seed a market
row directly for a drill), fill headline/labels/blurb, confirm the 09:00/12:00/20:00 ET defaults
(or override for a tighter drill), and submit. See §15.2 for the full validation set (`lock_at`
≤ `event_start_at` for live events, 48h resolve window, one daily per date). **Given the known
gap above, immediately follow curation with the lifecycle-scheduling workaround
(`apps/worker/scripts/question-zero-drill/manual-schedule.mjs`) until that gap is fixed** — do
not assume the question will progress on its own.

## 2. The Question Zero drill

Full procedure below; see `apps/worker/scripts/question-zero-drill/README.md` for the exact
companion commands (kept runnable, not just narrated) and
[`docs/audits/question-zero-drill-log.md`](../audits/question-zero-drill-log.md) for a real,
dated run's timing log and findings.

### Steps

1. **Environment**: disposable Postgres DB + isolated Redis db index, migrated + seeded (§1.2),
   `apps/web` and `apps/worker` both running against them.
2. **Seed a market**: `node scripts/question-zero-drill/seed-market.mjs` (from `apps/worker/`) —
   stands in for a `venue:sync-catalog` tick without needing real venue credentials.
3. **Curate**: `scripts/question-zero-drill/curate.sh` — real `POST /api/admin/questions`,
   open/lock/reveal a few minutes apart.
4. **Check scheduling** (this is where the known gap surfaces):
   `scripts/question-zero-drill/check-scheduled-jobs.sh <questionId>` — query `pgboss.job`
   directly. Expect 3 rows (`question:open`, `question:lock`, `reveal:fire`); until the gap
   above is fixed, expect 0.
5. **Work around the gap**: `scripts/question-zero-drill/manual-schedule.mjs` — enqueues the
   same three jobs `scheduleQuestionLifecycle` would.
6. **Open**: wait for `question:open` to fire (worker log + `GET /questions/:slug` — `status`
   flips to `open`, `crowd` stays `null`).
7. **Pick as ghosts**: real `POST /api/v1/questions/:id/picks` calls (need an `Origin` header
   matching `NEXT_PUBLIC_APP_URL` — the CSRF guard rejects same-site mutations without one, a
   real thing this drill hit and is not a bug). Confirm `crowd` stays hidden while open (§9.3).
8. **Worker-kill-at-lock recovery exercise** (the AC's specific callout, §5.7):
   - Shortly before `lock_at`, `kill -9` the worker process (its whole process group — `tsx
     watch` spawns a child; kill both, or the watcher just respawns it).
   - Optionally seed a `market_price_snapshots` row at `lock_at`
     (`scripts/question-zero-drill/seed-lock-snapshot.mjs`) with a value distinct from both the
     market's live price and whatever you inject into Redis next — this makes the eventual
     backfill assertion unambiguous.
   - Wait past `lock_at`. While the worker stays down, compare `GET /questions/:slug` (should
     read `"status": "locked"`) against a direct `SELECT status FROM questions WHERE id=...`
     (still literally `'open'`) — this is the effective-state rule (§5.7) working: read paths
     derive presentation from `lock_at` vs. now, not from the stale `status` column, precisely
     so a worker outage never blocks presentation.
   - Also attempt a pick during the outage (with a fresh price cache, so `PRICE_UNAVAILABLE`
     doesn't mask the check you're actually running) — expect `QUESTION_LOCKED`. This proves the
     pick endpoint's *own* `lock_at`-guarded `INSERT` (§6.2 step 3) rejects late picks
     independently of both the worker and the stale status column — belt and suspenders.
   - Inject a "the market moved while you were down" price into the Redis cache (recent
     timestamp, different value from the seeded snapshot) — this is the trap the late-fire logic
     must not fall into.
   - Restart the worker. It should immediately process the now-late `question:lock` job. Confirm
     `crowd_yes_at_lock`/`crowd_no_at_lock` match the picks placed in step 7, and
     `yes_price_at_lock` came from the seeded snapshot (nearest `lock_at`), **not** the injected
     post-outage cache value — this is `apps/worker/src/jobs/question-lock.ts`'s
     `resolveLockPrice` late-fire branch, and it's the concrete thing that makes "worker outage
     at lock is safe" true rather than aspirational.
9. **Settle via mock**: `scripts/question-zero-drill/settle-via-mock.mjs <questionId> <yes|no>`
   — grades the question exactly like `settlement:poll` would once a venue adapter reports
   `resolved`, without needing a live venue. Confirm the live worker picks up the
   transactionally-enqueued `grade:followup` job on its own.
10. **Reveal**: confirm `status` flips to `revealed`, `GET /questions/:slug/reveal` returns the
    full payload for a participating viewer (crowd split, outcome, viewer pick/result/edge/
    percentile/streak, narrative line, share URLs), and streaks incremented for all
    participants (winners and losers both — it's a participation streak, DD-3).
11. **Cards**: fetch `GET /api/og/question/:slug` (follow the redirect — it 302s to a
    content-hashed URL for CDN cache-busting, not a bug) and `GET /api/og/receipt/:pickId` for a
    participant's own pick. Both must return real `1200×630` PNGs with the actual headline/
    outcome/crowd-split baked in, not a blank or error image.
12. **Rollback exercise**: `PATCH /api/admin/questions/:id/void` with a reason (the post-reveal
    void path, §5.7/§15.3, available within `REGRADE_WINDOW_H` = 48h). Confirm `status='voided'`,
    every pick's `result='void'`/`edge=null`, and that the streak-replay side effect makes sense
    for the profiles involved (see §4 below — this is subtler than "streak unaffected").

### Known gap (headline finding)

Covered above under "STOP." This is THE Question Zero blocker: fix before scheduling a real
first question.

### Secondary finding: `share.og_url` in the reveal payload 404s

`apps/web/lib/reveal-payload.ts` builds `` og_url: `${appUrl}/api/og/q/${question.slug}` `` —
that route doesn't exist (confirmed: `curl .../api/og/q/<slug>` → `404`). The real OG route is
`/api/og/question/:slug` (confirmed: `200`, real PNG). The same wrong `/api/og/q/` path is also
hardcoded in two E2E fixtures (`apps/web/e2e/question-page.spec.ts`,
`apps/web/e2e/question-thread.spec.ts`), so nothing currently catches the mismatch. **Impact is
narrower than it first looks**: the question page's actual `<meta property="og:image">` tag
(`apps/web/app/q/[slug]/page.tsx`'s `generateMetadata`) independently builds the correct
`/api/og/question/...` URL, so social-preview unfurls of the page itself are fine. What's broken
is the `share.og_url` field inside the `GET /questions/:slug/reveal` JSON payload — anything that
reads that field specifically (a native share sheet, a future client feature) gets a 404. Small,
contained, one-line fix (`/api/og/q/` → `/api/og/question/`) touching `reveal-payload.ts` plus
the two test fixtures — flagged, not fixed here, same reasoning as the headline gap (out of this
task's scope; small enough for a fast-follow).

### Observation: `share.card_urls` is always `[]`

Also in `reveal-payload.ts` — `card_urls: []`, no `SPEC-GAP` comment. Working OG endpoints exist
for both the question card and a viewer's own receipt card (step 11 above proves both render
real images), so this looks like it could be populated. Not investigated further (out of scope
for this task) — worth a look before launch if any client surface expects this array to be
non-empty for a revealed question.

## 3. Monitoring during the first reveal

Watch `/admin/ops` (§15.5, WS10-T5) continuously through open → lock → reveal:

- **Job health** panel: every job in `apps/worker/src/registry.ts`'s `JOB_REGISTRY` should show
  a recent heartbeat (`job_heartbeats` table). A stale `question:lock`/`reveal:fire` heartbeat
  around the scheduled time is the first sign of exactly the outage this drill rehearses.
- **Venue adapter status**: last successful tick per venue. A `venue_degraded:{venue}` flag
  (§7.5, confirmed to set correctly during this drill — see the evidence log) means prices are
  serving from cache/DB fallback, not live — expected briefly, concerning if it persists through
  a lock.
- **Today's question status timeline** + **overdue-reveal alert**: the dashboard's read on the
  same effective-state logic step 8 above exercises directly.
- Golden-signal alerts (§16.1) to have paging, not just dashboard, for on launch day: reveal
  overdue (+60min unsettled), settlement poller stalled (15min), price tick stalled (5min while
  a question is open), pick 5xx rate (>2%/5min), any dead-lettered job.

## 4. Rollback procedure

Three admin actions, all audited (`audit_log`, §15.1) and all funneling into the same
`grade:followup` + streak-replay pipeline (§15.3 — "no bespoke side paths"):

| Situation | Action | Route | Notes |
|---|---|---|---|
| Venue resolution is late (poller lagging a confirmed real-world result) | Force-settle | `POST /api/admin/questions/:id/settle` | Only allowed ≥`FORCE_SETTLE_MIN_AFTER_CLOSE_MIN` (30min) after the venue market's `close_time`; requires typing the outcome. |
| Wrong resolution, or a **pre-reveal** question needs to be pulled | Void | `PATCH /api/admin/questions/:id/void` | Reachable from `scheduled`/`open`/`locked`. Streak-neutral by construction (§6.6 "Voided day D" — no increment, no break, chain preserved). |
| Venue resolution overturned **after** our reveal (e.g. a UMA dispute) | Post-reveal void | same route, `status='revealed'` case | Only within `REGRADE_WINDOW_H` (48h) of reveal. **Not streak-neutral in the same simple way** — see the caveat below. Live-tested in this drill (evidence log). |
| Outcome was right but graded wrong (rare) | Regrade | `POST /api/admin/questions/:id/regrade` | Within 48h. If ratings already applied for that period, requires the "deep regrade" path — restores pre-application rating snapshots for the whole period and re-runs it (Glicko-2 processes a period's games together; single-game reversal isn't attempted). |

**Post-reveal void streak caveat** (found while live-testing step 12 above, then verified by
reading `packages/db/src/streak-replay.ts`): a post-reveal void doesn't just "undo today," it
triggers a **full streak replay** for every affected profile (§5.7: "streak replay for
participants"), rebuilding `current_streak`/`best_streak`/`last_counted_date` from scratch by
replaying every *other* revealed-non-void daily in that profile's history. For a profile whose
*only* daily ever was the one just voided, replay correctly lands back at `current_streak=0` —
confirmed in this drill, and correct (they truly have no other answered history, so there is
nothing to "preserve"). This is **not** the same guarantee as a *pre*-reveal void's "treated as
answered, streak preserved, no increment" (§6.5) — that guarantee applies before the day was ever
counted; post-reveal void unwinds an increment that already happened. A profile with a **real**
prior streak whose *later* day gets post-reveal-voided was not separately drilled here (would
need ≥2 days of seeded history) — if you're about to run a post-reveal void against a profile
with a meaningful streak, read `replayStreak()`'s contiguous-day-advance logic first and consider
a small targeted drill before doing it against real users, especially since `REGRADE_WINDOW_H`
(48h) means this is realistic within Question Zero's own first two days.

## 5. Re-running the drill

`apps/worker/scripts/question-zero-drill/` has every scripted step; see that directory's
`README.md` for exact invocation (they must be run with `apps/worker` as cwd so Node's ESM
resolver finds the workspace packages). None of it is wired into CI/`pnpm verify` — it's a
by-hand operational exercise, same posture as `apps/web/load-tests/` (WS14-T2). Re-run this
drill:

- Before any real launch (obviously — and re-check the "Known gap" section first; if it's fixed,
  delete step 5/the `manual-schedule.mjs` workaround from your run and confirm step 4 now shows
  3 real rows).
- After any change to `apps/worker/src/jobs/question-{open,lock}.ts`, `reveal-fire.ts`,
  `settlement-poll.ts`, `grade-followup.ts`, or the admin settlement/void/regrade routes.
- Periodically even absent changes — this is exactly the kind of path (curate → nothing happens
  automatically) that's invisible in code review and only surfaces by actually running it, which
  is the entire reason this task exists.
