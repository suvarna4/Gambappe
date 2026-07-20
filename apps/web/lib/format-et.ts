/**
 * ET clock formatting for question-page copy (§10.3 "opens 9:00 ET", §13.2 "Reveal at 8").
 * Pure/deterministic given an ISO instant — no wall-clock reads — so it's safe to call from
 * both the server render and tests.
 */
import { SCHEDULE_TZ } from '@receipts/core';

/** "9:00am ET" / "8:00pm ET". */
export function formatEtClock(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map['hour']}:${map['minute']}${(map['dayPeriod'] ?? '').toLowerCase()} ET`;
}

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * SW9-T2 (obituary-handoff §3.3(1)): formats a `YYYY-MM-DD` calendar date (`zDateOnly`,
 * `packages/core`) into the short "b./d." label `ObituaryCard` expects, e.g. "2026-07-08" →
 * "Jul 08". Parsed as plain text rather than `new Date(...)`, so this is immune to the runtime's
 * local timezone — a bare calendar date has no time-of-day to get wrong across a UTC/ET offset.
 */
export function formatShortDate(dateOnly: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return dateOnly; // defensive — the contract's zDateOnly guarantees this shape
  const [, monthStr, dayStr] = match;
  const month = SHORT_MONTH_NAMES[Number(monthStr) - 1] ?? monthStr;
  return `${month} ${dayStr}`;
}

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

/**
 * SW10-T1 (wiring-gaps doc §4 SW10-T1, §12 round 6): formats a `YYYY-MM-DD` calendar date into
 * its weekday name ("2026-07-08" -> "Wednesday"), for the `nemesis_comeback` beat's `downDay`/
 * `levelDay` slots. Same timezone-immune posture as `formatShortDate`: never parse the bare date
 * in LOCAL time (`new Date('YYYY-MM-DD')` interpreted locally is not immune) — `Date.UTC` +
 * `getUTCDay()` is fine because a bare calendar date has no time-of-day to get wrong.
 */
export function formatWeekdayName(dateOnly: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return dateOnly; // defensive — the contract's zDateOnly guarantees this shape
  const [, yearStr, monthStr, dayStr] = match;
  const dow = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr))).getUTCDay();
  return WEEKDAY_NAMES[dow]!;
}

/**
 * SW10-T3 (wiring-gaps doc §4 SW10-T3): whole hours elapsed since `iso`, for the sealed
 * partner chip's "· {n}h AGO" segment. Clamped to >= 0 (a clock-skew instant slightly in the
 * future reads as "0h AGO" rather than a negative number).
 */
export function formatHoursAgo(iso: string, nowMsValue: number): number {
  const elapsedMs = nowMsValue - Date.parse(iso);
  return Math.max(0, Math.floor(elapsedMs / 3_600_000));
}
