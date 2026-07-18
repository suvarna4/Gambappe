/**
 * ET calendar-day windows for the `analytics:rollup` job (§4.3, §16.3): the job runs at
 * 04:00 ET and finalizes the ET calendar day that just completed, so every boundary must be
 * DST-correct — never a hardcoded UTC offset (§4.3). Uses the same Intl.DateTimeFormat
 * double-conversion trick used elsewhere in the repo for zoned-time math; reimplemented here
 * (rather than imported) since `apps/worker` cannot depend on `apps/web`.
 */
import { SCHEDULE_TZ } from '@receipts/core';

export interface DateWindow {
  start: Date;
  end: Date;
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
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

function zonedMidnightToUtc(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset1 = timeZoneOffsetMinutes(guess, timeZone);
  const utc1 = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = timeZoneOffsetMinutes(utc1, timeZone);
  return new Date(guess.getTime() - offset2 * 60_000);
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

/** The ET calendar date (YYYY-MM-DD) containing the given instant. */
export function etDateString(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map['year']}-${map['month']}-${map['day']}`;
}

/** The most recent Monday on/before the given ET calendar date (nemesis `week_start`, §5.5). */
export function mostRecentMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  return addDaysToDateStr(dateStr, -back);
}
