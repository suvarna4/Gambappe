/**
 * Verdict display logic for a completed (or in-progress) nemesis pairing (design doc §19.3
 * WS7-T6 AC: "verdict card win AND loss variants"; §8.8 winner/draw already computed
 * server-side by `nemesis:conclude` — this module only decides how to *render* that result
 * for a given viewer, never recomputes score/edge/tiebreak math, which is WS5-T3 scope).
 */
import type { DayResult, VerdictOutcome } from '@/components/nemesis/VerdictCard';
import type { NemesisHistoryEntry, PairingPublic, PairingScoreboardRow } from './types';

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
 * The week-strip dots for `VerdictCard`, viewer-relative — re-pinned in fable review round 4
 * after round 3's head-to-head "who took the day" model was found to contradict the real scorer
 * (`scoreNemesisWeek`, `packages/engine/src/scoring.ts`, awards each side's point independently —
 * a both-win day gives BOTH players +1 — so the dots have to mirror the viewer's own accrual, not
 * a comparison between sides, or the strip would contradict the `my_score`/`their_score` printed
 * above it). `win`/`loss` iff the viewer picked that row and was graded that way; `pending` while
 * the row is unsettled (masked pre-lock, or graded `null`); `neutral` for a `void` row or a row
 * the viewer never picked — the scorer awards nothing in either case. Every scoreboard row is
 * included, nemesis-bonus rows too (`question_date: null`) — `nemesis:conclude` counts those
 * toward the score, so dropping them would desync the dots from `my_score`/`their_score`.
 */
export function deriveDayResults(
  scoreboard: readonly PairingScoreboardRow[],
  viewerProfileId: string,
  pairing: Pick<PairingPublic, 'a' | 'b'>,
): DayResult[] {
  const viewerIsA = pairing.a.profile_id === viewerProfileId;
  return scoreboard.map((row): DayResult => {
    const own = viewerIsA ? row.a : row.b;
    if (!own) return 'neutral'; // no pick this row
    if (own.result === 'void') return 'neutral';
    if (own.result === 'win') return 'win';
    if (own.result === 'loss') return 'loss';
    // 'pending', or a null result — the row hasn't graded (or is still masked) yet.
    return 'pending';
  });
}
