/**
 * `/nemesis` page-state selection (design-diff audit: the mockup's three distinct nemesis-week
 * moments — Monday's assignment reveal, the daily reveal card's "second life" (already shipped
 * inline on `/q/[slug]`, PR #99), and Friday's verdict — used to all render STACKED on one page
 * (a compact `NemesisAssignmentCard`, then the full `NemesisMatchupCard` inlined, then
 * `NemesisHistoryList`). This decides which ONE of the remaining two is primary content, per this
 * codebase's convention of extracting this kind of branching into `lib/nemesis/` helpers rather
 * than inlining the conditionals in the page component (see `deriveDayResults`/`sideOutcome` in
 * `./verdict.ts`).
 */
import { nemesisConcludeAt } from './clock';
import type { NemesisHistoryEntry, PairingPublic } from './types';

export type NemesisPageState =
  | { kind: 'empty' }
  | { kind: 'assignment' }
  | { kind: 'verdict'; entry: NemesisHistoryEntry };

/**
 * How long a just-concluded week stays eligible to be the page's promoted "verdict" moment,
 * measured from that week's `nemesis:conclude` run (Sunday 22:00 ET). The real gap this state is
 * meant to fill is "Friday through the following Monday's `nemesis:assign` reassignment" — but a
 * window pinned to that exact ~11-hour Sunday-night-to-Monday-morning calendar slot is untestable
 * against this suite's real-wall-clock e2e posture (`next start` always runs `NODE_ENV=production`,
 * so there is no test-clock override; see `nemesis-rematch.spec.ts`'s header) and functionally
 * indistinguishable from a fixed-duration rolling window for the actual property this guards.
 * 8 days comfortably covers Sunday's conclusion through the following Monday's reassignment with
 * a full extra week of slack for a delayed/holiday-skipped `nemesis:assign` run, while still
 * bounding staleness to "recent" rather than "forever."
 */
const VERDICT_FRESH_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * This window is NOT redundant with the `pairing === null` check above it: `getCurrentPairingForProfile`
 * only ever returns a `status='active'` row (`lib/nemesis/service.ts`), so it also goes `null`
 * for a viewer who has simply dropped below `NEMESIS_MIN_PICKS` (re-checked every week by
 * `nemesis:assign`'s eligible-pool query, `apps/worker/src/jobs/nemesis-assign.ts`) and stopped
 * getting reassigned — a state that can persist indefinitely, not just overnight. Without this
 * window, such a viewer would see their last completed week's verdict prompt forever, every
 * visit, long after it stopped being "Friday's verdict" and became stale history — the exact
 * kind of "the last thing that happened, presented as if it just happened" bug the `empty` state
 * exists to avoid.
 */
function isVerdictStillFresh(weekStart: string, at: Date): boolean {
  const concludedAt = nemesisConcludeAt(weekStart);
  const msSinceConcluded = at.getTime() - concludedAt.getTime();
  return msSinceConcluded >= 0 && msSinceConcluded < VERDICT_FRESH_WINDOW_MS;
}

/**
 * - `assignment`: `getCurrentPairingForProfile` returned a pairing — there's an active week.
 * - `verdict`: no active pairing right now, the most recent history entry
 *   (`historyEntries[0]` — callers pass `getNemesisHistoryPage`'s `data`, already sorted
 *   newest-first by `listNemesisHistoryForProfile`'s `ORDER BY week_start DESC, id DESC`) has a
 *   real outcome (`outcome !== 'cancelled'`, matching `verdictOutcomeFromHistory`'s own
 *   cancelled → no-verdict-card convention), AND that week is still inside its fresh window
 *   (`isVerdictStillFresh`, above, `VERDICT_FRESH_WINDOW_MS`) — the recently-concluded gap this
 *   state is meant to fill, not an arbitrarily old settled week surfaced as if it just happened.
 * - `empty`: neither of the above.
 */
export function selectNemesisPageState(input: {
  pairing: PairingPublic | null;
  historyEntries: readonly NemesisHistoryEntry[];
  at: Date;
}): NemesisPageState {
  if (input.pairing) return { kind: 'assignment' };
  const mostRecent = input.historyEntries[0];
  if (
    mostRecent &&
    mostRecent.outcome !== 'cancelled' &&
    isVerdictStillFresh(mostRecent.week_start, input.at)
  ) {
    return { kind: 'verdict', entry: mostRecent };
  }
  return { kind: 'empty' };
}
