# Question Zero drill log (WS14-T4)

Evidence for the drill described in
[`docs/runbooks/launch-drill.md`](../runbooks/launch-drill.md) §2. Per that task's AC ("drill
executed, timing log attached; rollback steps documented"), this is the dated record of an
actual run — the runbook is the reusable procedure, this is proof it was executed for real.

## Method

Executed against a real local Postgres 16 + Redis 7 (not mocked), a disposable database
(`receipts_ws14t4`, migrated fresh via `drizzle-kit`) and an isolated Redis logical db, with
`apps/web` (`next dev`) and `apps/worker` (`tsx watch src/index.ts`) both running as real, live
processes — not simulated, not run inside a test harness. All HTTP calls (curation, picks, reads,
reveal, void) went through real `curl` requests against the running web app; the worker-kill step
used a real `kill -9` against the actual worker OS process. The one deliberate substitution:
`KALSHI_API_BASE`/`POLYMARKET_*_BASE` pointed at unreachable dummy URLs (no real venue
credentials in this environment) — this is why `venue:price-tick` errors appear in the worker
log throughout (see "Bonus finding" below); it does not affect any step's validity, and settling
"via mock" (the AC's own words) means avoiding live venues by design, not a shortcut taken here.

Companion scripts (`apps/worker/scripts/question-zero-drill/`) reproduce every scripted step
below and were themselves re-run as a second, independent pass to confirm they work standalone
(not just as a narrated transcript) — see "Second pass" at the end.

## Timing log (first pass, real wall-clock UTC timestamps)

```
2026-07-19T00:01:18Z  drill start
2026-07-19T00:01:19Z  question curated (POST /api/admin/questions returned) — id 019f77ad-60e7-78ba-bf1b-89e4bee76293,
                       slug 2026-07-19-will-the-question-zero-drill-complete-cleanly, status=scheduled

FINDING (critical, launch-blocking): checked pgboss.job immediately after curation via
  `SELECT name, data, state FROM pgboss.job WHERE data::text LIKE '%<questionId>%'` -> 0 rows.
  Only cron-driven jobs exist (duo:matchmaker, notify:dispatch, notify:pre-lock-reminder,
  settlement:poll, venue:price-tick). POST /api/admin/questions (apps/web/app/api/admin/
  questions/route.ts, WS10-T2) never calls scheduleQuestionLifecycle (apps/worker/src/jobs/
  question-lifecycle.ts) after insertQuestion. Confirmed by grep: the ONLY production callers
  of scheduleQuestionLifecycle are duo-window-roll.ts and nemesis-assign.ts (bonus-question
  paths) — the daily-question composer, the ONLY path that creates a `daily` question, never
  schedules question:open / question:lock / reveal:fire for it. A curated daily question sits
  in status='scheduled' forever with no automatic transition. This is THE Question Zero
  showstopper: as shipped on main, curating tomorrow's question via /admin/curate does nothing
  operationally. Working around this manually below to continue the drill and prove the rest
  of the pipeline (open/lock/settle/reveal/cards) is otherwise sound.

2026-07-19T00:01:55Z  manually enqueued question:open/lock + reveal:fire (workaround for the gap above,
                       byte-identical to scheduleQuestionLifecycle's own boss.send calls)
2026-07-19T00:02:14Z  question:open fired -> status=open (confirmed via GET /questions/:slug)
2026-07-19T00:02:41Z  3 ghost picks placed (2 yes, 1 no) via real POST /api/v1/questions/:id/picks;
                       crowd still null (pre-lock info-hiding, §9.3 holds)
                       PROFILES: ghost1=019f77ae-75d2-7e8f-ae33-0d8bf0c59c0e
                                 ghost2=019f77ae-7c75-7604-8167-ad694d368048
                                 ghost3(NO)=019f77ae-7f42-78e4-9776-6bafd70e8d73
2026-07-19T00:03:24Z  killing worker process group (SIGKILL) to begin worker-kill-at-lock recovery exercise
2026-07-19T00:06:13Z  confirmed: effective-state rule holds on GET /questions/:slug (API says "locked";
                       raw DB row status still literally 'open', crowd/price snapshot columns still null);
                       late-pick attempt independently rejected by the DB-clock lock_at guard
                       (first attempt returned PRICE_UNAVAILABLE — a genuinely stale price cache in this
                       fixture, not the check under test; re-attempted after refreshing the Redis price
                       cache to isolate the lock_at guard specifically)
2026-07-19T00:06:47Z  QUESTION_LOCKED confirmed on pick attempt with a fresh price cache (DB-clock
                       lock_at guard, independent of worker/status column — §6.2 step 3)
2026-07-19T00:06:56Z  restarting worker process (after injecting a "market moved during the outage"
                       price into Redis — 0.95, distinct from both the market's original 0.55 and the
                       seeded lock-time snapshot 0.81 — to test the late-fire branch doesn't fall for it)
2026-07-19T00:07:09Z  worker recovered: question:lock fired on restart (late by ~90s, past
                       PRICE_MAX_STALENESS_S=60s), status->locked, crowdYesAtLock=2 crowdNoAtLock=1
                       (matches the 2 yes / 1 no picks placed), yes_price_at_lock=0.81000 — the seeded
                       lock-time snapshot, NOT the injected 0.95 cache value and NOT the original 0.55
2026-07-19T00:07:44Z  running settlement:poll with an injected MockVenueAdapter (outcome=yes) via the
                       REAL runSettlementPoll (apps/worker/src/jobs/settlement-poll.ts) — same production
                       code, adapter swapped for a scripted mock instead of real Kalshi/Polymarket
2026-07-19T00:08:14Z  full pipeline complete: locked -> settled (mock) -> grade:followup -> revealed.
                       Bonus finding: the ORIGINAL reveal:fire (scheduled at reveal_at, before settlement
                       finished) correctly re-armed when it found the question not-yet-settled (§6.7);
                       grade:followup's fresh reveal:fire then fired promptly once mock settlement
                       completed. Picks graded correctly (2 win @ edge +0.45, 1 loss @ edge -0.45 —
                       matches (win?1:0) - p_side_entry for yes_price_at_entry=0.55); all 3 profiles'
                       current_streak/best_streak -> 1 (participation streak — the loser gets it too,
                       DD-3). GET /questions/:slug/reveal returns the full payload for a participating
                       viewer (crowd 2/1 = 66.7% yes, outcome yes, viewer pick/result=win/edge=0.45/
                       percentile=75/streak delta=1, narrative_line, share URLs).
2026-07-19T00:08:44Z  cards: GET /api/og/question/:slug -> 200, real 1200x630 PNG with the actual
                       headline/outcome/crowd-split rendered. GET /api/og/receipt/:pickId (ghost1's
                       winning pick) -> 200, real 1200x630 PNG.
                       FINDING (secondary, non-blocking): the reveal payload's own share.og_url field
                       (apps/web/lib/reveal-payload.ts) points at /api/og/q/:slug, which 404s -- the
                       real route is /api/og/question/:slug (confirmed above). Same wrong path is
                       hardcoded in apps/web/e2e/question-page.spec.ts and question-thread.spec.ts.
                       The page's own <meta property="og:image"> tag (apps/web/app/q/[slug]/page.tsx)
                       independently uses the correct path, so social unfurls of the page itself are
                       unaffected -- only the JSON payload's og_url field is wrong.
2026-07-19T00:09:50Z  exercising rollback: post-reveal void (§5.7/§15.3) via
                       PATCH /api/admin/questions/:id/void, reason supplied
2026-07-19T00:10:00Z  rollback confirmed: status=voided, all 3 picks -> result=void/edge=null.
                       current_streak/last_counted_date reverted to 0/null for all 3 profiles --
                       initially looked like a possible streak-preservation violation (§6.5 says void
                       days should not break streaks), but packages/db/src/streak-replay.ts's
                       replayStreak() shows this is correct for THIS scenario: these were fresh ghosts
                       whose ONLY daily was this now-voided one, so they had no prior streak to preserve
                       -- replayStreak advances last_counted_date across a voided day only when it's
                       contiguous with an existing run (lastCountedDate !== null), which none of these
                       profiles had. Re-verified by reading the replay function; not filing this as a
                       bug -- see the runbook's "Post-reveal void streak caveat" for the case NOT covered
                       here (a profile with a real prior streak).
2026-07-19T00:11:31Z  drill complete
```

## Second pass: committed scripts, run standalone

To confirm `apps/worker/scripts/question-zero-drill/*` work on their own (not just as a record of
ad hoc commands), re-ran the whole sequence a second time using only the committed scripts,
against the same live web+worker processes, with a fresh market/question:

- `seed-market.mjs` → seeded market `019f77ba-48cc-75c2-97ab-1fbdce562c26`.
- `curate.sh` → curated question `019f77ba-b6c5-7453-b118-1a3ee9e3042c` (`2026-07-20`, since the
  first pass's question already occupies `2026-07-19`'s partial-unique daily slot even after
  being voided).
- `check-scheduled-jobs.sh` → **0 rows again**, independently reproducing the headline finding.
- `manual-schedule.mjs` → scheduled the same 3 jobs; `question:open` and `question:lock` fired on
  time (`crowdYesAtLock=0`/`crowdNoAtLock=0` — no picks placed this pass, not exercised again).
- `settle-via-mock.mjs <questionId> no` → `{ graded: true, winCount: 0, lossCount: 0 }`,
  `grade:followup` enqueued; live worker picked it up, `reveal:fire` completed
  (`status='revealed'`, `outcome='no'`) within ~25s of the settle call.

All five scripts ran without modification from a fresh shell, confirming the runbook's
"Re-running the drill" section is accurate and not just a plan.

## Sign-off

| | |
|---|---|
| Audited/drilled commit | `95d7869286225795327e45b023de41771d034803` (`main`, tip at drill time; `WS14-T2: k6 load tests` #49, which includes the `percentile.ts` Redis-connection-guard fix from the earlier WS14-T2 follow-up) |
| Date | 2026-07-19 |
| Method | Live local dress rehearsal — real Postgres/Redis, real `next dev` + `tsx watch` worker processes, real HTTP calls, a real `kill -9` against the worker OS process, a real (unreachable) venue-URL misconfiguration exercising the venue-degraded circuit breaker incidentally. Settlement used a `MockVenueAdapter` injected into the real `runSettlementPoll` production function (first pass) and the equivalent `gradeResolvedQuestionTx` call the committed `settle-via-mock.mjs` makes (second pass) — no real venue network calls at any point. |
| Result | **Launch-blocking gap found**: daily-question curation never schedules its lifecycle jobs (see `docs/runbooks/launch-drill.md`'s "STOP" section) — do not launch until fixed. Everything downstream of curation — open, lock (including a full worker-kill-at-lock recovery with correct late-fire price backfill and independent DB-clock pick rejection), settle, grade, streak application, reveal, share cards, and post-reveal-void rollback — worked correctly when driven manually. One secondary, non-blocking bug found (`share.og_url` 404s; page metadata itself unaffected) and one observation (`share.card_urls` always empty) — both flagged in the runbook, not fixed here (out of this task's scope). |
| Signed | claude-sonnet5-vf9acd-orchestrator (WS14-T4) |
