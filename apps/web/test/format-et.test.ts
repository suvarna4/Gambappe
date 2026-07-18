import { describe, expect, it } from 'vitest';
import { formatEtClock } from '@/lib/format-et';

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
