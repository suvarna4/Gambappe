import { describe, expect, it } from 'vitest';
import { formatEtClock, formatShortDate, formatWeekdayName } from '@/lib/format-et';

describe('formatEtClock', () => {
  it('formats a UTC morning instant as ET (EDT, UTC-4, in July)', () => {
    // 13:00 UTC on 2026-07-19 = 9:00am EDT.
    expect(formatEtClock('2026-07-19T13:00:00Z')).toBe('9:00am ET');
  });

  it('formats an evening instant', () => {
    // 00:00 UTC on 2026-07-20 = 8:00pm EDT the prior day.
    expect(formatEtClock('2026-07-20T00:00:00Z')).toBe('8:00pm ET');
  });

  it('handles winter (EST, UTC-5)', () => {
    // 14:00 UTC on 2026-01-15 = 9:00am EST.
    expect(formatEtClock('2026-01-15T14:00:00Z')).toBe('9:00am ET');
  });
});

/** SW9-T2 (obituary-handoff §3.3(1)): the ObituaryCard "b./d." date label formatter. */
describe('formatShortDate', () => {
  it('formats a mid-year date', () => {
    expect(formatShortDate('2026-07-08')).toBe('Jul 08');
  });

  it('keeps the day zero-padded', () => {
    expect(formatShortDate('2026-01-01')).toBe('Jan 01');
  });

  it('formats December correctly (month-index boundary)', () => {
    expect(formatShortDate('2026-12-25')).toBe('Dec 25');
  });

  it('is immune to local timezone — never rolls the calendar date via Date parsing', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu'; // UTC-10 — the negative-offset class this guards against
    try {
      // Proves the bug class is real under this timezone: a naive `new Date(dateOnly)` parses
      // as UTC midnight, which displays as the PREVIOUS calendar day here.
      expect(new Date('2026-07-01').toLocaleDateString('en-US', { timeZone: 'Pacific/Honolulu' })).toBe(
        '6/30/2026',
      );
      // The real formatter never constructs a `Date`, so it stays correct under the same TZ.
      expect(formatShortDate('2026-07-01')).toBe('Jul 01');
    } finally {
      process.env.TZ = original;
    }
  });
});

/** SW10-T1 (wiring-gaps doc §4 SW10-T1, §12 round 6): the `nemesis_comeback` weekday formatter. */
describe('formatWeekdayName', () => {
  it('formats a mid-week date', () => {
    expect(formatWeekdayName('2026-07-08')).toBe('Wednesday');
  });

  it('formats a year boundary', () => {
    expect(formatWeekdayName('2026-01-01')).toBe('Thursday');
  });

  it('formats a December date', () => {
    expect(formatWeekdayName('2026-12-25')).toBe('Friday');
  });

  it('is immune to local timezone — never rolls the calendar date via Date parsing', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu'; // UTC-10 — same bug class `formatShortDate`'s own test guards against
    try {
      // Proves the bug class is real under this timezone: a naive `new Date(dateOnly)` parses
      // as UTC midnight, which rolls to the PREVIOUS calendar day (and so the previous weekday)
      // here.
      expect(new Date('2026-07-01').toLocaleDateString('en-US', { timeZone: 'Pacific/Honolulu', weekday: 'long' })).toContain(
        'Tuesday',
      );
      // The real formatter never constructs a `Date` from the bare string in local time, so it
      // stays correct (Wednesday) under the same TZ.
      expect(formatWeekdayName('2026-07-01')).toBe('Wednesday');
    } finally {
      process.env.TZ = original;
    }
  });
});
