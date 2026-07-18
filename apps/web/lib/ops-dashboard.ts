/**
 * Ops dashboard (§15.5, §16.1, WS10-T5): job heartbeat staleness + the overdue-reveal alert.
 *
 * Staleness thresholds are tiered by expected cadence rather than duplicating every cron
 * string from `apps/worker/src/registry.ts` (a separate app this one can't import) — two
 * tiers are pinned exactly to §16.1's named alerts (`settlement:poll` 15 min,
 * `venue:price-tick` 5 min); everything else falls into a cadence bucket with generous
 * slack. Queue-only jobs (no cron — enqueued transactionally or per-event) are never flagged
 * stale on cadence alone; a truly stuck one shows up via `lastErrorAt` instead. Keep this
 * table in sync if `registry.ts`'s schedule changes.
 */
import { SCHEDULE_TZ } from '@receipts/core';
import { zonedTimeToUtc } from './curation';

/** The ET calendar date (YYYY-MM-DD) containing the given instant. */
export function etDateString(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map['year']}-${map['month']}-${map['day']}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** [start, end) UTC instants of the given ET calendar date, reusing curation.ts's converter. */
export function etDayWindow(dateStr: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(dateStr, '00:00', SCHEDULE_TZ),
    end: zonedTimeToUtc(addDaysToDateStr(dateStr, 1), '00:00', SCHEDULE_TZ),
  };
}

export interface JobHeartbeatRow {
  jobName: string;
  lastStartedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
}

export interface JobHealth extends JobHeartbeatRow {
  /** True when the job hasn't succeeded within its expected cadence (or never has). */
  stale: boolean;
  /** True when the most recent event was a failure (regardless of staleness). */
  erroring: boolean;
}

/** §16.1's two explicitly-specced alert thresholds. */
const PINNED_THRESHOLD_MIN: Record<string, number> = {
  'settlement:poll': 15,
  'venue:price-tick': 5,
};

/** Jobs with no cron (§7.6) — enqueued transactionally or per-event; never cadence-stale. */
const NON_PERIODIC_JOBS = new Set([
  'grade:followup',
  'question:open',
  'question:lock',
  'reveal:fire',
  'wallet:ingest',
]);

/** Cadence-bucketed defaults (minutes) for jobs without a pinned §16.1 threshold. */
const CADENCE_THRESHOLD_MIN: Record<string, number> = {
  'venue:sync-catalog': 90, // hourly
  'duo:matchmaker': 5, // sub-minute cron
  'notify:dispatch': 5, // sub-minute cron
  'streak:sweep': 26 * 60, // daily
  'fingerprint:nightly': 26 * 60, // daily
  'analytics:rollup': 26 * 60, // daily
  'maintenance:prune': 26 * 60, // daily
  'streak:freeze-grant': 8 * 24 * 60, // weekly
  'ratings:weekly': 8 * 24 * 60, // weekly
  'nemesis:conclude': 8 * 24 * 60, // weekly
  'nemesis:lastday': 8 * 24 * 60, // weekly
  'nemesis:assign': 8 * 24 * 60, // weekly
  'duo:window-roll': 4.5 * 24 * 60, // twice weekly
};

function thresholdMinutesFor(jobName: string): number | null {
  if (NON_PERIODIC_JOBS.has(jobName)) return null;
  return PINNED_THRESHOLD_MIN[jobName] ?? CADENCE_THRESHOLD_MIN[jobName] ?? 90;
}

export function computeJobHealth(rows: JobHeartbeatRow[], at: Date): JobHealth[] {
  return rows.map((row) => {
    const thresholdMin = thresholdMinutesFor(row.jobName);
    const staleByCadence =
      thresholdMin !== null &&
      (!row.lastSuccessAt || at.getTime() - row.lastSuccessAt.getTime() > thresholdMin * 60_000);
    const erroring = !!row.lastErrorAt && (!row.lastSuccessAt || row.lastErrorAt > row.lastSuccessAt);
    return { ...row, stale: staleByCadence, erroring };
  });
}
