/**
 * Nemesis week timing helpers (design doc §2.3 "Weekly engine flow": Sunday 22:00 ET
 * `nemesis:conclude`; §8.8 shared set = dailies with `question_date` in
 * `[week_start, week_start+6]`). Reuses the ET-anchored instant conversion already built for
 * curation (`zonedTimeToUtc`, WS10-T2) rather than re-deriving DST math — §4.3: "never
 * hardcode UTC offsets."
 *
 * The plain `YYYY-MM-DD` date arithmetic below (`addDaysToDateString`, `etDateString`,
 * `isoWeekMonday`) is intentionally self-contained rather than imported from
 * `@receipts/core` — this task's base (`main`) doesn't yet have those helpers (they land
 * separately via another in-flight task's contract-change PR); duplicating ~10 lines here
 * avoids taking an undeclared dependency on unmerged sibling work. If/when that PR merges
 * and exports equivalents from core, these three helpers can be deleted in favor of it.
 */
import { SCHEDULE_TZ } from '@receipts/core';
import { zonedTimeToUtc } from '@/lib/curation';

/** `dateStr` (`YYYY-MM-DD`) shifted by `days` (may be negative), as `YYYY-MM-DD`. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `at`'s calendar date in `SCHEDULE_TZ`, as `YYYY-MM-DD`. */
export function etDateString(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULE_TZ }).format(at);
}

/** The Monday of the ISO week containing `dateStr` (`YYYY-MM-DD`), as `YYYY-MM-DD`. */
export function isoWeekMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  return addDaysToDateString(dateStr, -(isoDow - 1));
}

/** Last calendar date (`question_date`) in the shared set for `weekStart` (§8.8, inclusive). */
export function nemesisWeekEndDate(weekStart: string): string {
  return addDaysToDateString(weekStart, 6);
}

/**
 * The instant scoring/verdicts happen for this pairing's week — `nemesis:conclude` runs
 * Sunday 22:00 ET (§2.3). This is what "time remaining in the pairing" counts down to while
 * the pairing is `active`.
 */
export function nemesisConcludeAt(weekStart: string): Date {
  return zonedTimeToUtc(nemesisWeekEndDate(weekStart), '22:00', SCHEDULE_TZ);
}
