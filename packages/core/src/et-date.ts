/**
 * ET calendar-date helpers (DD-1: single global schedule in `SCHEDULE_TZ`). `question_date` and
 * similar `date` columns are ET calendar days; several call sites (today's daily lookup, the
 * freeze-earn window, the weekly leaderboard window) need "what ET date is `at`" and simple
 * day arithmetic on the resulting `YYYY-MM-DD` string.
 */
import { SCHEDULE_TZ } from './config.js';

/** `at`'s calendar date in `SCHEDULE_TZ`, as `YYYY-MM-DD`. */
export function etDateString(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULE_TZ }).format(at);
}

/** `dateStr` (`YYYY-MM-DD`) shifted by `days` (may be negative), as `YYYY-MM-DD`. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the ISO week containing `dateStr` (`YYYY-MM-DD`), as `YYYY-MM-DD`. */
export function isoWeekMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  return addDaysToDateString(dateStr, -(isoDow - 1));
}
