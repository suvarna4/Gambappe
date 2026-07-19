/**
 * SW3-T2 · Reveal-choreography obituary handoff (swipe-ux-plan §2.6 "Obituary handoff" / §2.7
 * `ObituaryCard`, SW4-T1). Decides whether `RevealSequence`'s final beat should swap the plain
 * share button for the obituary card, and builds its props from fields `RevealPayload.viewer`
 * already carries — no new endpoint, per §2.13 invariant 1 ("zero engine/API changes").
 *
 * Detection: a broken streak shows up in the payload as `streak.current === 0` on a `loss`
 * result — the shape the reveal-sequence test fixtures already model (see
 * `e2e/question-page.spec.ts`'s reduced-motion reveal test: `{ current: 0, best: 4, delta: -4 }`
 * for a losing pick). `delta` is defined as `current - previous` (`lib/reveal-payload.ts`), so
 * `previous = current - delta` recovers the EXACT length of the run that just ended — no
 * approximation needed for `days`, unlike `ripDays`/`GraveyardShelf`'s open SPEC-GAP.
 *
 * SPEC-GAP(SW3-T2): `RevealPayload.viewer` carries no per-day pick-log facts (longest-odds hit,
 * freezes used, hardest day — the obituary's "Survived" list, §2.7) and no exact start date
 * beyond counting back `days` from today — the same gap `GraveyardShelf`'s own SPEC-GAP note
 * flags for `ripDays` history (`components/GraveyardShelf.tsx`). `facts` is built empty here;
 * `ObituaryCard` already omits the "Survived" section when `facts.length === 0`, so this degrades
 * cleanly rather than fabricating data. A future `packages/core` contract addition (recording the
 * broken run's actual pick-log facts on the reveal payload) would let this be filled in.
 */
import { addDaysToDateString, type RevealViewer } from '@receipts/core';
import { impliedCents, OBITUARY_MIN_STREAK } from '@receipts/ui';
import type { ObituaryFact } from '@/components/ObituaryCard';

/** True iff this reveal is the moment a real (≥ `OBITUARY_MIN_STREAK`-day) streak just ended —
 * see the module doc for exactly what "current === 0 on a loss" means here. */
export function streakBrokeThisReveal(viewer: RevealViewer): boolean {
  if (viewer.result !== 'loss') return false;
  if (viewer.streak.current !== 0) return false;
  const previous = viewer.streak.current - viewer.streak.delta;
  return previous >= OBITUARY_MIN_STREAK;
}

export interface ObituaryHandoffProps {
  days: number;
  startLabel: string;
  endLabel: string;
  facts: ObituaryFact[];
  sideLabel: string;
  entryCents: number;
}

/** "Jul 08" — short month/day, parsed as a UTC calendar date (matches `question_date`'s
 * `YYYY-MM-DD` ET-calendar-date convention elsewhere, e.g. `packages/core/src/et-date.ts`). */
function formatObituaryDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: '2-digit' }).format(
    new Date(`${dateStr}T00:00:00Z`),
  );
}

/**
 * Builds `ObituaryCard`'s props from a reveal payload whose `viewer` already satisfies
 * `streakBrokeThisReveal`. `questionDate` is the daily's own `question_date` (today, ET calendar
 * date) — the day the streak ended, since the losing pick that ended it is `viewer.pick` itself.
 */
export function buildObituaryHandoffProps(
  viewer: RevealViewer,
  questionDate: string,
  sideLabels: { yes: string; no: string },
): ObituaryHandoffProps {
  const days = viewer.streak.current - viewer.streak.delta;
  const endLabel = formatObituaryDate(questionDate);
  const startLabel = formatObituaryDate(addDaysToDateString(questionDate, -(days - 1)));
  const sideLabel = viewer.pick.side === 'yes' ? sideLabels.yes : sideLabels.no;
  const entryCents = impliedCents(viewer.pick.side, viewer.pick.yes_price_at_entry);
  const facts: ObituaryFact[] = [];
  return { days, startLabel, endLabel, facts, sideLabel, entryCents };
}
