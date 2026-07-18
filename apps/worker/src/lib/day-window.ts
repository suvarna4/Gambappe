/**
 * Zoned calendar-day/time-of-day math for `apps/worker` jobs (§4.3, §16.3, §13.2): DST-correct
 * conversion between an IANA zone's local wall-clock time and a UTC instant — never a
 * hardcoded UTC offset (§4.3). Uses the Intl.DateTimeFormat double-conversion trick used
 * elsewhere in the repo for zoned-time math; reimplemented here (rather than imported) since
 * `apps/worker` cannot depend on `apps/web`.
 *
 * Most of this file predates WS9-T1 and is ET-only (`analytics:rollup`, §16.3 fixed schedule).
 * WS9-T1 (`notify:dispatch`, §13.2 quiet hours) needs the same math against an ARBITRARY
 * profile timezone, so the general `zoned*` functions below were added and the existing
 * ET-only functions now delegate to them — behavior for existing callers is unchanged.
 */
import { SCHEDULE_TZ } from '@receipts/core';

export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * Offset (minutes, UTC − zoned; negative west of UTC, e.g. ET ≈ −300) of `timeZone` at the
 * instant `date` represents. Exported (WS5-T1) for `nemesis:assign`'s TZ_BONUS computation
 * (§8.4) — the same DST-correct double-conversion trick this file already used internally.
 */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map['year']),
    Number(map['month']) - 1,
    Number(map['day']),
    Number(map['hour']),
    Number(map['minute']),
    Number(map['second']),
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * UTC instant of `hh:mm` local time on `dateStr` in the given IANA zone. General form of the
 * old ET-only `zonedMidnightToUtc` (hh=mm=0); DST-correct via the same guess/correct
 * double-conversion (a second pass re-derives the offset from the first guess's UTC instant,
 * which self-corrects the rare case where the initial guess's offset was itself wrong near a
 * DST transition).
 */
export function zonedLocalTimeToUtc(
  dateStr: string,
  hh: number,
  mm: number,
  timeZone: string,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offset1 = timeZoneOffsetMinutes(guess, timeZone);
  const utc1 = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = timeZoneOffsetMinutes(utc1, timeZone);
  return new Date(guess.getTime() - offset2 * 60_000);
}

function zonedMidnightToUtc(dateStr: string, timeZone: string): Date {
  return zonedLocalTimeToUtc(dateStr, 0, 0, timeZone);
}

/** `dateStr` shifted by `days` (may be negative), as a new YYYY-MM-DD string. */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** [start, end) UTC instants of the given ET calendar date. */
export function etDayWindow(dateStr: string): DateWindow {
  return {
    start: zonedMidnightToUtc(dateStr, SCHEDULE_TZ),
    end: zonedMidnightToUtc(addDaysToDateStr(dateStr, 1), SCHEDULE_TZ),
  };
}

/** [start, end) UTC instants of the `days`-day window ending on (and including) dateStr. */
export function trailingWindow(dateStr: string, days: number): DateWindow {
  return {
    start: zonedMidnightToUtc(addDaysToDateStr(dateStr, -(days - 1)), SCHEDULE_TZ),
    end: zonedMidnightToUtc(addDaysToDateStr(dateStr, 1), SCHEDULE_TZ),
  };
}

/** The local calendar date (YYYY-MM-DD) containing the given instant, in the given IANA zone. */
export function zonedDateString(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map['year']}-${map['month']}-${map['day']}`;
}

/** The ET calendar date (YYYY-MM-DD) containing the given instant. */
export function etDateString(instant: Date): string {
  return zonedDateString(instant, SCHEDULE_TZ);
}

/** The most recent Monday on/before the given ET calendar date (nemesis `week_start`, §5.5). */
export function mostRecentMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  return addDaysToDateStr(dateStr, -back);
}
