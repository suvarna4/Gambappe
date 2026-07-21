/**
 * The job registry — every §7.6 job, complete, PLUS `bot:score` (WS11-T2). §7.6's table
 * (and this registry's history before WS11-T2) didn't have a slot for the nightly bot-scoring
 * heuristic §14.2 requires; the nearest existing job, `fingerprint:nightly`, belongs to a
 * separate, undelivered workstream (WS4-T7) that WS11-T2 doesn't depend on, so folding bot
 * scoring into that stub would mean two unrelated workstreams racing to fill in the same
 * handler. Adding a dedicated job is the smaller, contained deviation from the doc's literal
 * table — called out here and in the WS11-T2 PR description rather than silently reusing
 * someone else's slot. All cron times are America/New_York (SCHEDULE_TZ); pg-boss singleton
 * crons prevent double-fire, and every handler is idempotent + heartbeat-writing (§19.4 rule 4).
 *
 * Jobs without a cron are queue-only: enqueued transactionally (grade:followup, §6.5),
 * per-question (question:open/lock), or per-event (wallet:ingest). Per D-J3 (WS19-T1) there is
 * no clock-scheduled reveal job: a daily settles the moment its market resolves, in
 * `grade:followup`'s same tick (`settleQuestion`), not on a per-question `reveal_at` clock.
 *
 * NOTE on 30s cadences (duo:matchmaker, notify:dispatch): pg-boss cron granularity is one
 * minute; the owning tasks (WS6-T1, WS9-T1) implement the sub-minute tick by self-requeue
 * with startAfter inside the minute cron. The stub runs at the minute cron meanwhile.
 *
 * NOTE on `duo:window-roll`'s owner: §19.3's WBS table lists this job under WS6-T3 ("Ladder +
 * windows"), not WS6-T2 ("Match lifecycle + scoring + chemistry") — but WS6-T2's own task brief
 * explicitly scoped implementing the window-roll handler itself (match creation via WS4-T5's
 * `matchDuoVsDuo` + bonus authoring + the straggler backstop that calls WS6-T2's completion
 * logic), leaving WS6-T3 to add ladder promotion/relegation (§8.10) on top of an
 * already-working window-roll rather than building the job from scratch. Flagged here (and in
 * the WS6-T2 PR description) since it's a real deviation from the doc's literal task-to-job
 * mapping — WS6-T3, when claimed, should treat this handler as already done and scope its own
 * work to §8.10 only.
 */
import { SCHEDULE_TZ } from '@receipts/core';
import type { JobHandler } from './heartbeat.js';
import { analyticsRollupHandler } from './jobs/analytics-rollup.js';
import { botScoreHandler } from './jobs/bot-score.js';
import { duoMatchmakerHandler } from './jobs/duo-matchmaker.js';
import { duoWindowRollHandler } from './jobs/duo-window-roll.js';
import { fingerprintNightlyHandler } from './jobs/fingerprint-nightly.js';
import { gradeFollowupHandler } from './jobs/grade-followup.js';
import { maintenancePruneHandler } from './jobs/maintenance-prune.js';
import { nemesisAssignHandler } from './jobs/nemesis-assign.js';
import { nemesisConcludeHandler } from './jobs/nemesis-conclude.js';
import { nemesisLastdayHandler } from './jobs/nemesis-lastday.js';
import { notifyDispatchHandler } from './jobs/notify-dispatch.js';
import { preLockReminderHandler } from './jobs/pre-lock-reminder.js';
import { questionLockHandler } from './jobs/question-lock.js';
import { questionOpenHandler } from './jobs/question-open.js';
import { ratingsWeeklyHandler } from './jobs/ratings-weekly.js';
import { settleDigestHandler } from './jobs/settle-digest.js';
import { settlementPollHandler } from './jobs/settlement-poll.js';
import { streakFreezeGrantHandler } from './jobs/streak-freeze-grant.js';
import { streakSweepHandler } from './jobs/streak-sweep.js';
import { venuePriceTickHandler } from './jobs/venue-price-tick.js';
import { venueSyncCatalogHandler } from './jobs/venue-sync-catalog.js';
import { walletIngestHandler } from './jobs/wallet-ingest.js';

export interface JobDefinition {
  name: string;
  /** §7.6 owner task (documentation + ops). */
  owner: string;
  /** 5-field cron in SCHEDULE_TZ; absent = queue-only job. */
  cron?: string;
  handler: JobHandler;
}

export const SCHEDULE_TIMEZONE = SCHEDULE_TZ;

/** Complete §7.6 registry, in table order. */
export const JOB_REGISTRY: readonly JobDefinition[] = [
  {
    name: 'venue:sync-catalog',
    owner: 'WS1-T4',
    cron: '10 * * * *', // hourly :10
    handler: venueSyncCatalogHandler,
  },
  {
    name: 'venue:price-tick',
    owner: 'WS1-T4',
    cron: '* * * * *', // every 60s
    handler: venuePriceTickHandler,
  },
  {
    name: 'settlement:poll',
    owner: 'WS1-T5',
    cron: '*/5 * * * *', // every 5 min
    handler: settlementPollHandler,
  },
  {
    name: 'grade:followup',
    owner: 'WS3-T3',
    // Enqueued transactionally by grading (§6.5) — no cron.
    handler: gradeFollowupHandler,
  },
  {
    name: 'question:open',
    owner: 'WS3-T1',
    // Per-question at open_at — scheduled sends, no cron.
    handler: questionOpenHandler,
  },
  {
    name: 'question:lock',
    owner: 'WS3-T1',
    handler: questionLockHandler,
  },
  {
    name: 'notify:pre-lock-reminder',
    owner: 'WS9-T4',
    cron: '*/5 * * * *', // every 5 min; PRE_LOCK_REMINDER_LEAD_MIN + dedupe_key make the exact tick harmless
    handler: preLockReminderHandler,
  },
  {
    name: 'settle:digest',
    owner: 'WS19-T1',
    cron: '0 21 * * *', // daily 21:00 ET — one summary push for a profile's 2nd+ settles that day (D-J3)
    handler: settleDigestHandler,
  },
  {
    name: 'streak:sweep',
    owner: 'WS3-T3',
    cron: '30 3 * * *', // daily 03:30 ET
    handler: streakSweepHandler,
  },
  {
    name: 'streak:freeze-grant',
    owner: 'WS3-T3',
    cron: '5 0 * * 1', // Mon 00:05 ET
    handler: streakFreezeGrantHandler,
  },
  {
    name: 'fingerprint:nightly',
    owner: 'WS4-T7',
    cron: '0 3 * * *', // daily 03:00 ET
    handler: fingerprintNightlyHandler,
  },
  {
    name: 'ratings:weekly',
    owner: 'WS4-T7',
    cron: '0 23 * * 0', // Sun 23:00 ET
    handler: ratingsWeeklyHandler,
  },
  {
    name: 'nemesis:conclude',
    owner: 'WS5-T3',
    cron: '0 22 * * 0', // Sun 22:00 ET
    handler: nemesisConcludeHandler,
  },
  {
    name: 'nemesis:lastday',
    owner: 'WS9-T3',
    cron: '0 9 * * 0', // Sun 09:00 ET
    handler: nemesisLastdayHandler,
  },
  {
    name: 'nemesis:assign',
    owner: 'WS5-T1',
    cron: '0 9 * * 1', // Mon 09:00 ET
    handler: nemesisAssignHandler,
  },
  {
    name: 'wallet:ingest',
    owner: 'WS12-T2',
    // Enqueued per link (§12.2) — no cron.
    handler: walletIngestHandler,
  },
  {
    name: 'duo:matchmaker',
    owner: 'WS6-T1',
    cron: '* * * * *', // every 30s per spec; minute cron + WS6-T1 self-requeue (see header)
    handler: duoMatchmakerHandler,
  },
  {
    name: 'duo:window-roll',
    owner: 'WS6-T2', // see file header note — §19.3 nominally lists WS6-T3
    cron: '0 9 * * 2,5', // Tue/Fri 09:00 ET
    handler: duoWindowRollHandler,
  },
  {
    name: 'notify:dispatch',
    owner: 'WS9-T1',
    cron: '* * * * *', // every 30s per spec; minute cron + WS9-T1 self-requeue (see header)
    handler: notifyDispatchHandler,
  },
  {
    name: 'bot:score',
    owner: 'WS11-T2',
    cron: '15 3 * * *', // daily 03:15 ET — before analytics:rollup (04:00) so bot_flag_rate sees fresh scores
    handler: botScoreHandler,
  },
  {
    name: 'analytics:rollup',
    owner: 'WS13-T2',
    cron: '0 4 * * *', // daily 04:00 ET
    handler: analyticsRollupHandler,
  },
  {
    name: 'maintenance:prune',
    owner: 'WS0-T4',
    cron: '30 4 * * *', // daily 04:30 ET
    handler: maintenancePruneHandler,
  },
] as const;

export const JOB_NAMES = JOB_REGISTRY.map((j) => j.name);
