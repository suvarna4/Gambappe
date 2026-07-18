/**
 * WS0-T4 AC: the job registry contains a stub (or implementation) for EVERY §7.6 job — PLUS
 * `bot:score` (WS11-T2), a deliberate addition beyond the doc's literal table (see the
 * registry.ts header comment for why the §14.2 bot-scoring heuristic needed its own slot).
 */
import { describe, expect, it } from 'vitest';
import { JOB_NAMES, JOB_REGISTRY, SCHEDULE_TIMEZONE } from '../src/registry.js';

/** The §7.6 job table, verbatim, plus `bot:score` (WS11-T2). */
const SPEC_JOBS = [
  'venue:sync-catalog',
  'venue:price-tick',
  'settlement:poll',
  'grade:followup',
  'question:open',
  'question:lock',
  'reveal:fire',
  'streak:sweep',
  'streak:freeze-grant',
  'fingerprint:nightly',
  'ratings:weekly',
  'nemesis:conclude',
  'nemesis:lastday',
  'nemesis:assign',
  'wallet:ingest',
  'duo:matchmaker',
  'duo:window-roll',
  'notify:dispatch',
  'bot:score',
  'analytics:rollup',
  'maintenance:prune',
] as const;

/** Jobs the spec schedules on cron (vs queue-only enqueued jobs). */
const QUEUE_ONLY = ['grade:followup', 'question:open', 'question:lock', 'reveal:fire', 'wallet:ingest'];

describe('job registry (§7.6)', () => {
  it('covers every spec job, no extras, no duplicates', () => {
    expect([...JOB_NAMES].sort()).toEqual([...SPEC_JOBS].sort());
    expect(new Set(JOB_NAMES).size).toBe(SPEC_JOBS.length);
  });

  it('every job has a handler function and an owner task id', () => {
    for (const job of JOB_REGISTRY) {
      expect(typeof job.handler, job.name).toBe('function');
      expect(job.owner).toMatch(/^WS\d+-T\d+$/);
    }
  });

  it('cron-scheduled jobs have valid 5-field expressions; queue-only jobs have none', () => {
    for (const job of JOB_REGISTRY) {
      if (QUEUE_ONLY.includes(job.name)) {
        expect(job.cron, job.name).toBeUndefined();
      } else {
        expect(job.cron, job.name).toBeDefined();
        expect(job.cron!.trim().split(/\s+/), job.name).toHaveLength(5);
      }
    }
  });

  it('all cron schedules are anchored to America/New_York (§7.6)', () => {
    expect(SCHEDULE_TIMEZONE).toBe('America/New_York');
  });

  it('pins the §7.6 schedule times', () => {
    const byName = Object.fromEntries(JOB_REGISTRY.map((j) => [j.name, j.cron]));
    expect(byName['venue:sync-catalog']).toBe('10 * * * *');
    expect(byName['settlement:poll']).toBe('*/5 * * * *');
    expect(byName['streak:sweep']).toBe('30 3 * * *');
    expect(byName['streak:freeze-grant']).toBe('5 0 * * 1');
    expect(byName['fingerprint:nightly']).toBe('0 3 * * *');
    expect(byName['ratings:weekly']).toBe('0 23 * * 0');
    expect(byName['nemesis:conclude']).toBe('0 22 * * 0');
    expect(byName['nemesis:lastday']).toBe('0 9 * * 0');
    expect(byName['nemesis:assign']).toBe('0 9 * * 1');
    expect(byName['duo:window-roll']).toBe('0 9 * * 2,5');
    expect(byName['bot:score']).toBe('15 3 * * *');
    expect(byName['analytics:rollup']).toBe('0 4 * * *');
    expect(byName['maintenance:prune']).toBe('30 4 * * *');
  });
});
