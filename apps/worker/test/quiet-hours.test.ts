/**
 * WS9-T1 AC (§13.2, §19.3): "notification scheduled at 23:00 local gets deferred to 08:00, not
 * sent immediately." July dates use America/New_York's EDT (UTC-4) offset, matching
 * day-window.test.ts's DST fixtures.
 */
import { describe, expect, it } from 'vitest';
import { resolveQuietHoursDeferral } from '../src/lib/quiet-hours.js';

const ET = 'America/New_York';

describe('resolveQuietHoursDeferral (§13.2 quiet hours)', () => {
  it('AC: 23:00 local defers to the NEXT 08:00 local, not sent immediately', () => {
    const at2300ET = new Date('2026-07-20T03:00:00Z'); // 23:00 EDT on 2026-07-19
    const deferred = resolveQuietHoursDeferral(at2300ET, ET);
    expect(deferred).not.toBeNull();
    expect(deferred!.toISOString()).toBe('2026-07-20T12:00:00.000Z'); // 08:00 EDT on 2026-07-20
  });

  it('defers a small-hours instant (05:00 local) to THAT SAME day\'s 08:00 local', () => {
    const at0500ET = new Date('2026-07-19T09:00:00Z'); // 05:00 EDT
    const deferred = resolveQuietHoursDeferral(at0500ET, ET);
    expect(deferred).not.toBeNull();
    expect(deferred!.toISOString()).toBe('2026-07-19T12:00:00.000Z'); // 08:00 EDT same date
  });

  it('does not defer an awake-hours instant (10:00 local)', () => {
    const at1000ET = new Date('2026-07-19T14:00:00Z'); // 10:00 EDT
    expect(resolveQuietHoursDeferral(at1000ET, ET)).toBeNull();
  });

  it('boundary: exactly 22:00 local IS quiet (deferred)', () => {
    const at2200ET = new Date('2026-07-20T02:00:00Z'); // 22:00 EDT on 2026-07-19
    expect(resolveQuietHoursDeferral(at2200ET, ET)).not.toBeNull();
  });

  it('boundary: exactly 08:00 local is awake (NOT deferred — the resumption instant itself sends)', () => {
    const at0800ET = new Date('2026-07-19T12:00:00Z'); // 08:00 EDT
    expect(resolveQuietHoursDeferral(at0800ET, ET)).toBeNull();
  });

  it('defaults sensibly for a non-ET zone too (America/Los_Angeles, UTC-7 in July)', () => {
    const at2330PT = new Date('2026-07-20T06:30:00Z'); // 23:30 PDT on 2026-07-19
    const deferred = resolveQuietHoursDeferral(at2330PT, 'America/Los_Angeles');
    expect(deferred).not.toBeNull();
    expect(deferred!.toISOString()).toBe('2026-07-20T15:00:00.000Z'); // 08:00 PDT on 2026-07-20
  });
});
