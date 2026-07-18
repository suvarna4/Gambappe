/**
 * Quiet-hours deferral (§13.2, WS9-T1): "non-reveal notifications deferred to
 * QUIET_HOURS_END_LOCAL if scheduled QUIET_HOURS_START_LOCAL–QUIET_HOURS_END_LOCAL" (profile
 * timezone, default SCHEDULE_TZ). The window wraps midnight (22:00 today → 08:00 tomorrow).
 */
import { QUIET_HOURS_END_LOCAL, QUIET_HOURS_START_LOCAL } from '@receipts/core';
import { addDaysToDateStr, zonedDateString, zonedLocalTimeToUtc } from './day-window.js';

function parseHHMM(hhmm: string): [number, number] {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return [h, m];
}

/**
 * Returns the UTC instant of the next local QUIET_HOURS_END_LOCAL if `instant` falls inside the
 * quiet-hours window in `timeZone`, else `null` (send now — awake hours). Boundaries: the start
 * time itself IS quiet (deferred); the end time itself is awake (not deferred) — matches "20:00
 * / 08:00" style HH:mm boundary conventions used elsewhere in the doc (DAILY_* schedule, §6.2).
 */
export function resolveQuietHoursDeferral(instant: Date, timeZone: string): Date | null {
  const [startH, startM] = parseHHMM(QUIET_HOURS_START_LOCAL);
  const [endH, endM] = parseHHMM(QUIET_HOURS_END_LOCAL);
  const dateStr = zonedDateString(instant, timeZone);
  const todayStart = zonedLocalTimeToUtc(dateStr, startH, startM, timeZone);
  const todayEnd = zonedLocalTimeToUtc(dateStr, endH, endM, timeZone);

  if (instant >= todayStart) {
    // Between today's QUIET_HOURS_START_LOCAL and tomorrow's QUIET_HOURS_END_LOCAL.
    return zonedLocalTimeToUtc(addDaysToDateStr(dateStr, 1), endH, endM, timeZone);
  }
  if (instant < todayEnd) {
    // Still before today's QUIET_HOURS_END_LOCAL (i.e. the tail of last night's window).
    return todayEnd;
  }
  return null;
}
