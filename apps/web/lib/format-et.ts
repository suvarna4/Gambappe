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
