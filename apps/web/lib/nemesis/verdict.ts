/**
 * Verdict display logic for a completed (or in-progress) nemesis pairing (design doc §19.3
 * WS7-T6 AC: "verdict card win AND loss variants"; §8.8 winner/draw already computed
 * server-side by `nemesis:conclude` — this module only decides how to *render* that result
 * for a given viewer, never recomputes score/edge/tiebreak math, which is WS5-T3 scope).
 */
import type { DayResult, VerdictOutcome } from '@/components/nemesis/VerdictCard';
import { addDaysToDateString } from './clock';
import type { NemesisHistoryEntry, PairingPublic, PairingScoreboardRow } from './types';

/** §8.8's shared set is every `daily` question with `question_date` in `[week_start,
 * week_start+6]` — 7 calendar days, always, by definition of that inclusive range. Both the
 * "DAYS" strip on a settled week (`deriveWeekDayResults`) and the empty-dot count on assignment
 * day (`app/nemesis/page.tsx`) key off this SAME constant, so the two exhibits always show the
 * same number of dots regardless of how many of those 7 days actually have a real question row
 * in a given environment (design-diff audit: they briefly didn't, in a sparsely-seeded dev DB
 * where one calendar day's `daily` question had never been created). */
export const NEMESIS_SHARED_WEEK_DAYS = 7;

export type PairingOutcome = 'in_progress' | 'cancelled' | 'win' | 'loss' | 'draw' | 'unknown';

export type SideOutcome = 'pending' | 'cancelled' | 'win' | 'loss' | 'draw';

/**
 * The OBJECTIVE result for one named side (`a` or `b`) of a pairing — who actually won,
 * independent of who's looking. This is what the public matchup card's verdict stamps use
 * (design doc §19.3 WS7-T6 AC: "verdict card win AND loss variants"): `/vs/[pairingId]` is a
 * `none`-auth page whose server render must stay viewer-free (INV-10), so the verdict can
 * never be "did YOU win" there — it has to be "who won," shown identically to every visitor.
 */
export function sideOutcome(
  pairing: Pick<PairingPublic, 'status' | 'winner_profile_id'>,
  sideProfileId: string,
): SideOutcome {
  if (pairing.status === 'cancelled') return 'cancelled';
  if (pairing.status !== 'completed') return 'pending';
  if (pairing.winner_profile_id === null) return 'draw';
  return pairing.winner_profile_id === sideProfileId ? 'win' : 'loss';
}

/**
 * `'unknown'` only when the pairing is `completed` with no `winner_profile_id` AND the
 * viewer isn't a participant — i.e. a spectator looking at someone else's draw, where
 * "win"/"loss" framing doesn't apply to them either. Participants always get `'draw'`.
 *
 * This is the VIEWER-RELATIVE framing ("did *I* win") — useful for first-person copy on a
 * viewer-aware surface (e.g. `/nemesis`'s own narration), but NOT what the public matchup
 * card's stamps should use; see `sideOutcome` above for that.
 */
export function deriveOutcome(
  pairing: Pick<PairingPublic, 'status' | 'winner_profile_id' | 'a' | 'b'>,
  viewerProfileId: string | null,
): PairingOutcome {
  if (pairing.status === 'cancelled') return 'cancelled';
  if (pairing.status !== 'completed') return 'in_progress';

  const viewerIsParticipant =
    viewerProfileId !== null &&
    (viewerProfileId === pairing.a.profile_id || viewerProfileId === pairing.b.profile_id);
  if (!viewerIsParticipant) return 'unknown';

  if (pairing.winner_profile_id === null) return 'draw';
  return pairing.winner_profile_id === viewerProfileId ? 'win' : 'loss';
}

/** The opposing side's `ProfileRef`, from the viewer's point of view (null for spectators). */
export function opponentOf(
  pairing: Pick<PairingPublic, 'a' | 'b'>,
  viewerProfileId: string | null,
): PairingPublic['a'] | PairingPublic['b'] | null {
  if (viewerProfileId === pairing.a.profile_id) return pairing.b;
  if (viewerProfileId === pairing.b.profile_id) return pairing.a;
  return null;
}

// --- SW10-T2: verdict-card data derivation (design doc's sw-revamp-wiring-gaps.md §4 SW10-T2,
// "corrected across both fable review rounds") ------------------------------------------------

/**
 * `NemesisHistoryEntry.outcome` → `VerdictCard`'s `VerdictOutcome`. `null` for `'cancelled'` —
 * `VerdictOutcome` has no cancelled member by design (a cancelled week gets no verdict card at
 * all; callers keep whatever plain fallback the history row already used).
 */
export function verdictOutcomeFromHistory(outcome: NemesisHistoryEntry['outcome']): VerdictOutcome | null {
  if (outcome === 'win') return 'won';
  if (outcome === 'loss') return 'lost';
  if (outcome === 'draw') return 'drew';
  return null;
}

/** `|my_score - their_score|` — the score-margin the week was decided by. `nemesisHistoryEntrySchema`
 * carries only these two counts (no edge/streak-of-weeks data), so this is the whole of what the
 * verdict copy is allowed to assert (see `copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`). */
export function scoreMarginFromHistory(entry: Pick<NemesisHistoryEntry, 'my_score' | 'their_score'>): number {
  return Math.abs(entry.my_score - entry.their_score);
}

/**
 * Per-row viewer-relative day result — re-pinned in fable review round 4 after round 3's
 * head-to-head "who took the day" model was found to contradict the real scorer
 * (`scoreNemesisWeek`, `packages/engine/src/scoring.ts`, awards each side's point independently —
 * a both-win day gives BOTH players +1 — so the dots have to mirror the viewer's own accrual, not
 * a comparison between sides, or the strip would contradict the `my_score`/`their_score` printed
 * above it). `win`/`loss` iff the viewer picked that row and was graded that way; `pending` while
 * the row is unsettled (masked pre-lock, or graded `null`); `neutral` for a `void` row or a row
 * the viewer never picked — the scorer awards nothing in either case. Shared by both
 * `deriveDayResults` and `deriveWeekDayResults` below — the two differ only in which rows they
 * feed it and how they're keyed/counted, not in the per-row result rule itself.
 */
function dayResultForRow(row: Pick<PairingScoreboardRow, 'a' | 'b'>, viewerIsA: boolean): DayResult {
  const own = viewerIsA ? row.a : row.b;
  if (!own) return 'neutral'; // no pick this row
  if (own.result === 'void') return 'neutral';
  if (own.result === 'win') return 'win';
  if (own.result === 'loss') return 'loss';
  // 'pending', or a null result — the row hasn't graded (or is still masked) yet.
  return 'pending';
}

/**
 * Row-order-based day results, one per scoreboard row — INCLUDES the nemesis-bonus row
 * (`question_date: null`), since `nemesis:conclude` counts it toward the score and dropping it
 * would desync this list from `my_score`/`their_score`. No current production caller (design-diff
 * audit: the day-by-day dot strip that used to render this moved to `NemesisHeadToHeadBanner`'s
 * own strip, which needs exactly `NEMESIS_SHARED_WEEK_DAYS` calendar-keyed entries instead — see
 * `deriveWeekDayResults` below — not this row-order shape); kept, and still exercised directly by
 * `test/nemesis/verdict.test.ts`, as the score-accurate row-order variant for any future caller
 * that needs per-row (not per-calendar-day) results.
 */
export function deriveDayResults(
  scoreboard: readonly PairingScoreboardRow[],
  viewerProfileId: string,
  pairing: Pick<PairingPublic, 'a' | 'b'>,
): DayResult[] {
  const viewerIsA = pairing.a.profile_id === viewerProfileId;
  return scoreboard.map((row) => dayResultForRow(row, viewerIsA));
}

/**
 * The "DAYS" strip for `NemesisHeadToHeadBanner` (design-diff audit — moved out of `VerdictCard`
 * in an earlier round; see that banner's own header) — ALWAYS `NEMESIS_SHARED_WEEK_DAYS` (7)
 * entries, one per calendar day of the week, keyed by `question_date` rather than raw scoreboard
 * row order. `deriveDayResults` above is deliberately row-order-based and INCLUDES the
 * nemesis_bonus row (it counts toward the real score) — right for staying in sync with
 * `my_score`/`their_score`, wrong for a calendar-day strip, which wants exactly one dot per real
 * day and nothing else. A day with no matching `daily` row (sparse data, or a day the pairing's
 * week hasn't reached yet) renders `neutral` — the same "nothing to report" bucket a void/no-pick
 * row already uses — rather than being silently omitted and shrinking the strip.
 */
export function deriveWeekDayResults(
  weekStart: string,
  scoreboard: readonly PairingScoreboardRow[],
  viewerProfileId: string,
  pairing: Pick<PairingPublic, 'a' | 'b'>,
): DayResult[] {
  const viewerIsA = pairing.a.profile_id === viewerProfileId;
  const byDate = new Map<string, PairingScoreboardRow>();
  for (const row of scoreboard) {
    if (row.kind === 'daily' && row.question_date) byDate.set(row.question_date, row);
  }
  return Array.from({ length: NEMESIS_SHARED_WEEK_DAYS }, (_, i) => {
    const date = addDaysToDateString(weekStart, i);
    const row = byDate.get(date);
    return row ? dayResultForRow(row, viewerIsA) : 'neutral';
  });
}
