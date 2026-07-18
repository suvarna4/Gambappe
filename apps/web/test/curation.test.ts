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
  it('produces open 09:00 / lock 12:00 / reveal 20:00 ET as UTC instants', () => {
    const times = computeDefaultQuestionTimes('2026-07-19');
    expect(times.openAt.toISOString()).toBe('2026-07-19T13:00:00.000Z');
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

  it('passes for a well-formed non-sports question with no gaps', () => {
    expect(validateComposerInput(baseMarket, baseTimes)).toEqual([]);
  });

  it('rejects a market that closes before lock', () => {
    const market = { ...baseMarket, closeTime: new Date('2026-07-19T15:00:00Z') };
    expect(validateComposerInput(market, baseTimes)).toContain(
      'market close_time must be at or after lock_at',
    );
  });

  it('rejects an expected resolution more than 48h after lock', () => {
    const market = {
      ...baseMarket,
      expectedResolveTime: new Date('2026-07-22T00:00:01Z'), // lock + 48h + 1s
    };
    expect(validateComposerInput(market, baseTimes)).toContain(
      'expected resolution must be within 48h of lock_at',
    );
  });

  it('allows an expected resolution exactly at the 48h boundary', () => {
    const market = { ...baseMarket, expectedResolveTime: new Date('2026-07-21T16:00:00Z') };
    expect(validateComposerInput(market, baseTimes)).toEqual([]);
  });

  it('rejects lock_at after event_start_at', () => {
    const times = { ...baseTimes, eventStartAt: new Date('2026-07-19T15:00:00Z') };
    expect(validateComposerInput(baseMarket, times)).toContain(
      'lock_at must be at or before event_start_at (no in-play entry, §6.2)',
    );
  });

  it('requires event_start_at for sports markets', () => {
    const market = { ...baseMarket, category: 'sports' };
    expect(validateComposerInput(market, baseTimes)).toContain(
      'event_start_at is required for sports/live-event markets',
    );
  });

  it('accepts a sports market once event_start_at is provided and consistent', () => {
    const market = { ...baseMarket, category: 'sports' };
    const times = { ...baseTimes, eventStartAt: new Date('2026-07-19T18:00:00Z') };
    expect(validateComposerInput(market, times)).toEqual([]);
  });

  it('can report multiple violations at once', () => {
    const market = {
      category: 'sports',
      closeTime: new Date('2026-07-19T15:00:00Z'),
      expectedResolveTime: null as Date | null,
    };
    const errors = validateComposerInput(market, baseTimes);
    expect(errors).toHaveLength(2);
  });
});
