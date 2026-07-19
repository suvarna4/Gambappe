import { describe, expect, it } from 'vitest';
import { formatEtClock, formatShortDate } from '@/lib/format-et';

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
    // A naive `new Date('2026-07-08')` interpretation could roll to Jul 07 in a negative-offset
    // timezone; this formatter never constructs a `Date` at all.
    expect(formatShortDate('2026-07-01')).toBe('Jul 01');
  });
});
