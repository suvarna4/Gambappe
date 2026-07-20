import { describe, expect, it } from 'vitest';
import {
  computeDefaultQuestionTimes,
  validateComposerInput,
  zonedTimeToUtc,
} from '../lib/curation';

describe('zonedTimeToUtc', () => {
  it('converts 09:00 ET to 13:00 UTC in EDT (summer, UTC-4)', () => {
    const result = zonedTimeToUtc('2026-07-19', '09:00', 'America/New_York');
    expect(result.toISOString()).toBe('2026-07-19T13:00:00.000Z');
  });

  it('converts 09:00 ET to 14:00 UTC in EST (winter, UTC-5)', () => {
    const result = zonedTimeToUtc('2026-01-15', '09:00', 'America/New_York');
    expect(result.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('is DST-correct across the spring-forward boundary (2026-03-08 in the US)', () => {
    // Before: EST (UTC-5). After: EDT (UTC-4). 2026-03-08 02:00 local is the transition.
    const before = zonedTimeToUtc('2026-03-07', '09:00', 'America/New_York');
    const after = zonedTimeToUtc('2026-03-09', '09:00', 'America/New_York');
    expect(before.toISOString()).toBe('2026-03-07T14:00:00.000Z'); // UTC-5
    expect(after.toISOString()).toBe('2026-03-09T13:00:00.000Z'); // UTC-4
  });
});

describe('computeDefaultQuestionTimes', () => {
  it('produces open 03:00 (midnight PT) / lock 12:00 / reveal 20:00 ET as UTC instants', () => {
    const times = computeDefaultQuestionTimes('2026-07-19');
    expect(times.openAt.toISOString()).toBe('2026-07-19T07:00:00.000Z'); // 03:00 EDT == 00:00 PDT
    expect(times.lockAt.toISOString()).toBe('2026-07-19T16:00:00.000Z');
    expect(times.revealAt.toISOString()).toBe('2026-07-20T00:00:00.000Z'); // 20:00 ET = next-day UTC
  });
});

describe('validateComposerInput', () => {
  const baseMarket = {
    category: 'politics',
    closeTime: new Date('2026-07-19T16:00:00Z'),
    expectedResolveTime: null as Date | null,
  };
  const baseTimes = {
    openAt: new Date('2026-07-19T13:00:00Z'),
    lockAt: new Date('2026-07-19T16:00:00Z'),
    revealAt: new Date('2026-07-20T00:00:00Z'),
    eventStartAt: null as Date | null,
  };
  /** A "now" safely before lock — the WS15-T6 past-lock guardrail is exercised separately. */
  const AT = new Date('2026-07-19T10:00:00Z');

  it('passes for a well-formed non-sports question with no gaps', () => {
    expect(validateComposerInput(baseMarket, baseTimes, AT)).toEqual([]);
  });

  it('rejects a market that closes before lock', () => {
    const market = { ...baseMarket, closeTime: new Date('2026-07-19T15:00:00Z') };
    expect(validateComposerInput(market, baseTimes, AT)).toContain(
      'market close_time must be at or after lock_at',
    );
  });

  it('rejects an expected resolution more than 48h after lock', () => {
    const market = {
      ...baseMarket,
      expectedResolveTime: new Date('2026-07-22T00:00:01Z'), // lock + 48h + 1s
    };
    expect(validateComposerInput(market, baseTimes, AT)).toContain(
      'expected resolution must be within 48h of lock_at',
    );
  });

  it('allows an expected resolution exactly at the 48h boundary', () => {
    const market = { ...baseMarket, expectedResolveTime: new Date('2026-07-21T16:00:00Z') };
    expect(validateComposerInput(market, baseTimes, AT)).toEqual([]);
  });

  it('rejects lock_at after event_start_at', () => {
    const times = { ...baseTimes, eventStartAt: new Date('2026-07-19T15:00:00Z') };
    expect(validateComposerInput(baseMarket, times, AT)).toContain(
      'lock_at must be at or before event_start_at (no in-play entry, §6.2)',
    );
  });

  it('requires event_start_at for sports markets', () => {
    const market = { ...baseMarket, category: 'sports' };
    expect(validateComposerInput(market, baseTimes, AT)).toContain(
      'event_start_at is required for sports/live-event markets',
    );
  });

  it('accepts a sports market once event_start_at is provided and consistent', () => {
    const market = { ...baseMarket, category: 'sports' };
    const times = { ...baseTimes, eventStartAt: new Date('2026-07-19T18:00:00Z') };
    expect(validateComposerInput(market, times, AT)).toEqual([]);
  });

  it('can report multiple violations at once', () => {
    const market = {
      category: 'sports',
      closeTime: new Date('2026-07-19T15:00:00Z'),
      expectedResolveTime: null as Date | null,
    };
    const errors = validateComposerInput(market, baseTimes, AT);
    expect(errors).toHaveLength(2);
  });

  it('rejects a lock_at already in the past (WS15-T6 stillborn-question guardrail)', () => {
    const lateNow = new Date('2026-07-20T06:19:00Z'); // 02:19 ET on the 20th — the staging incident
    const errors = validateComposerInput(baseMarket, baseTimes, lateNow);
    expect(errors.some((e) => e.startsWith('lock_at is already in the past'))).toBe(true);
    expect(errors.join(' ')).toContain('2026-07-20'); // hints the current ET product day
  });

  it('allows a past open_at when lock_at is still in the future (compose-today-late flow)', () => {
    const midMorning = new Date('2026-07-19T14:30:00Z'); // after open (13:00Z), before lock (16:00Z)
    expect(validateComposerInput(baseMarket, baseTimes, midMorning)).toEqual([]);
  });
});
