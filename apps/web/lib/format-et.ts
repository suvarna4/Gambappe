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
