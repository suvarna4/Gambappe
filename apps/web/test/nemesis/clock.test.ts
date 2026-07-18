import { describe, expect, it } from 'vitest';
import { nemesisConcludeAt, nemesisWeekEndDate } from '../../lib/nemesis/clock';

describe('nemesisWeekEndDate', () => {
  it('is week_start + 6 days (the Sunday of the shared-question range, §8.8)', () => {
    expect(nemesisWeekEndDate('2026-07-13')).toBe('2026-07-19'); // Mon -> Sun
  });
});

describe('nemesisConcludeAt', () => {
  it('is Sunday 22:00 ET for the pairing week, in EDT (summer, UTC-4)', () => {
    // 2026-07-13 is a Monday; the following Sunday is 2026-07-19.
    const at = nemesisConcludeAt('2026-07-13');
    expect(at.toISOString()).toBe('2026-07-20T02:00:00.000Z'); // 22:00 EDT = 02:00 UTC next day
  });

  it('is Sunday 22:00 ET for the pairing week, in EST (winter, UTC-5)', () => {
    // 2026-01-12 is a Monday; the following Sunday is 2026-01-18.
    const at = nemesisConcludeAt('2026-01-12');
    expect(at.toISOString()).toBe('2026-01-19T03:00:00.000Z'); // 22:00 EST = 03:00 UTC next day
  });
});
