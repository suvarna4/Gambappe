/**
 * The job registry — every §7.6 job, complete. All cron times are America/New_York
 * (SCHEDULE_TZ); pg-boss singleton crons prevent double-fire, and every handler is
 * idempotent + heartbeat-writing (§19.4 rule 4).
 *
 * Jobs without a cron are queue-only: enqueued transactionally (grade:followup, §6.5),
 * per-question (question:open/lock, reveal:fire), or per-event (wallet:ingest).
 *
 * NOTE on 30s cadences (duo:matchmaker, notify:dispatch): pg-boss cron granularity is one
 * minute; the owning tasks (WS6-T1, WS9-T1) implement the sub-minute tick by self-requeue
 * with startAfter inside the minute cron. The stub runs at the minute cron meanwhile.
 */
import { SCHEDULE_TZ } from '@receipts/core';
import type { JobHandler } from './heartbeat.js';
import { analyticsRollupHandler } from './jobs/analytics-rollup.js';
import { maintenancePruneHandler } from './jobs/maintenance-prune.js';
import { settlementPollHandler } from './jobs/settlement-poll.js';
import { stubHandler } from './jobs/stubs.js';
import { venuePriceTickHandler } from './jobs/venue-price-tick.js';
import { venueSyncCatalogHandler } from './jobs/venue-sync-catalog.js';

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
    handler: stubHandler('grade:followup', 'WS3-T3'),
  },
  {
    name: 'question:open',
    owner: 'WS3-T1',
    // Per-question at open_at — scheduled sends, no cron.
    handler: stubHandler('question:open', 'WS3-T1'),
  },
  {
    name: 'question:lock',
    owner: 'WS3-T1',
    handler: stubHandler('question:lock', 'WS3-T1'),
  },
  {
    name: 'reveal:fire',
    owner: 'WS3-T4',
    // Per-question at reveal_at (+30min re-arm, §6.7).
    handler: stubHandler('reveal:fire', 'WS3-T4'),
  },
  {
    name: 'streak:sweep',
    owner: 'WS3-T3',
    cron: '30 3 * * *', // daily 03:30 ET
    handler: stubHandler('streak:sweep', 'WS3-T3'),
  },
  {
    name: 'streak:freeze-grant',
    owner: 'WS3-T3',
    cron: '5 0 * * 1', // Mon 00:05 ET
    handler: stubHandler('streak:freeze-grant', 'WS3-T3'),
  },
  {
    name: 'fingerprint:nightly',
    owner: 'WS4-T7',
    cron: '0 3 * * *', // daily 03:00 ET
    handler: stubHandler('fingerprint:nightly', 'WS4-T7'),
  },
  {
    name: 'ratings:weekly',
    owner: 'WS4-T7',
    cron: '0 23 * * 0', // Sun 23:00 ET
    handler: stubHandler('ratings:weekly', 'WS4-T7'),
  },
  {
    name: 'nemesis:conclude',
    owner: 'WS5-T3',
    cron: '0 22 * * 0', // Sun 22:00 ET
    handler: stubHandler('nemesis:conclude', 'WS5-T3'),
  },
  {
    name: 'nemesis:lastday',
    owner: 'WS9-T3',
    cron: '0 9 * * 0', // Sun 09:00 ET
    handler: stubHandler('nemesis:lastday', 'WS9-T3'),
  },
  {
    name: 'nemesis:assign',
    owner: 'WS5-T1',
    cron: '0 9 * * 1', // Mon 09:00 ET
    handler: stubHandler('nemesis:assign', 'WS5-T1'),
  },
  {
    name: 'wallet:ingest',
    owner: 'WS12-T2',
    // Enqueued per link (§12.2) — no cron.
    handler: stubHandler('wallet:ingest', 'WS12-T2'),
  },
  {
    name: 'duo:matchmaker',
    owner: 'WS6-T1',
    cron: '* * * * *', // every 30s per spec; minute cron + WS6-T1 self-requeue (see header)
    handler: stubHandler('duo:matchmaker', 'WS6-T1'),
  },
  {
    name: 'duo:window-roll',
    owner: 'WS6-T3',
    cron: '0 9 * * 2,5', // Tue/Fri 09:00 ET
    handler: stubHandler('duo:window-roll', 'WS6-T3'),
  },
  {
    name: 'notify:dispatch',
    owner: 'WS9-T1',
    cron: '* * * * *', // every 30s per spec; minute cron + WS9-T1 self-requeue (see header)
    handler: stubHandler('notify:dispatch', 'WS9-T1'),
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
