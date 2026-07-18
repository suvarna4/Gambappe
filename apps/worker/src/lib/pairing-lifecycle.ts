/**
 * Nemesis pairing state machine — the §5.7 mid-week exit rule (design doc §5.7, §14.3, WS5-T1):
 *
 *   Mid-week exit (block, pause, suspension, deletion by either side): if NO shared question has
 *   graded yet → `cancelled` (no rating change, no verdict card). If ≥1 shared question has
 *   graded → EARLY CONCLUSION: the pairing completes immediately, scored per §8.8 on graded
 *   questions only, with normal rating application — so a losing player cannot erase a loss by
 *   exiting (integrity rule; see §14.3's red-team-flagged block/report abuse vector).
 *
 * This is deliberately a REUSABLE function (not inlined into `nemesis:assign`, which never
 * triggers it) — `apps/web`'s blocks endpoint (`apps/web/lib/moderation.ts`'s `applyBlock`,
 * WS11-T3) already implements this rule for the "block" trigger, but only counts the pairing's
 * `nemesis_bonus` shared questions (`getPairingSharedQuestionPicks`) — the week's DAILY shared
 * questions (§8.8: "derived by date", 7 of them vs. 0–3 bonus) are silently excluded there. This
 * module uses the corrected `getFullPairingSharedQuestionPicks` (packages/db, new in this task)
 * so any exit reason computed here counts a pairing's full shared set. `apps/web` cannot import
 * `apps/worker` code (§4.2), so this does not retroactively fix `applyBlock`'s call site — see
 * the WS5-T1 PR description for that gap (flagged, not silently patched into another
 * workstream's already-merged apps/web file, which is out of this task's apps/worker + packages/db
 * scope).
 *
 * Callers: `nemesis:assign` doesn't call this (it only creates new pairings). This module exists
 * for future apps/worker-side triggers (e.g. an admin action dispatched as a worker job) and is
 * exercised directly by this task's own integration tests. `apps/web`'s account-deletion
 * (`packages/db/src/repositories/account-deletion.ts`, WS2-T5) and admin suspend/pause
 * (`apps/web/app/api/admin/reports/[id]/route.ts`, WS10-T4) both still have a documented
 * SPEC-GAP for exactly this rule (confirmed by grep — neither calls any pairing-exit function
 * today); wiring THEM to call the equivalent logic is a small apps/web follow-up outside this
 * task's file scope (apps/worker + minimal additive packages/db), flagged prominently in the PR.
 */
import { updateGlicko2, scoreNemesisWeek, type GlickoGame } from '@receipts/engine';
import {
  findActivePairingInvolving,
  getFullPairingSharedQuestionPicks,
  getOrDefaultRating,
  incrementGamesCount,
  insertNeutralExitNotification,
  updatePairingConclusion,
  updateRating,
  type Db,
  type NemesisPairingRow,
} from '@receipts/db';
import { addDaysToDateStr } from './day-window.js';

/** Why the pairing is exiting mid-week (§5.7) — carried into the verdict payload for narration/
 * admin visibility, not otherwise behavior-affecting (all reasons follow the same rule). */
export type PairingExitReason = 'blocked' | 'paused' | 'suspended' | 'deleted';

function toGlickoGame(opponent: { rating: number; rd: number }, score: 0 | 0.5 | 1): GlickoGame {
  return { opponentRating: opponent.rating, opponentRd: opponent.rd, score };
}

export interface PairingExitOutcome {
  outcome: 'cancelled' | 'completed' | 'noop';
  pairingId?: string;
}

/**
 * Applies the §5.7 mid-week exit rule to one pairing, inside one transaction. `pairing` must
 * currently be `active` (callers resolve it via `findActivePairingInvolving`/
 * `applyPairingMidWeekExitForProfile` below) — anything else is a no-op (idempotent: a
 * re-delivered call after the pairing already concluded must never double-apply a rating).
 */
export async function applyPairingMidWeekExit(
  db: Db,
  pairing: NemesisPairingRow,
  reason: PairingExitReason,
  at: Date,
): Promise<PairingExitOutcome> {
  if (pairing.status !== 'active') {
    return { outcome: 'noop' };
  }

  return db.transaction(async (tx) => {
    const weekEnd = addDaysToDateStr(pairing.weekStart, 6);
    const sharedQuestions = await getFullPairingSharedQuestionPicks(
      tx,
      { id: pairing.id, weekStart: pairing.weekStart, weekEnd },
      pairing.profileAId,
      pairing.profileBId,
    );
    const anyGraded = sharedQuestions.some((q) => q.isSettled && !q.isVoid);

    if (!anyGraded) {
      await updatePairingConclusion(tx, pairing.id, { status: 'cancelled', verdict: { reason } }, at);
    } else {
      const { scoreA, scoreB, edgeA, edgeB, winner, excludedQuestionIds } = scoreNemesisWeek(
        sharedQuestions.map((q) => ({
          questionId: q.questionId,
          isVoid: q.isVoid,
          isSettled: q.isSettled,
          profileA: q.profileAPick,
          profileB: q.profileBPick,
        })),
      );
      const winnerProfileId = winner === 'a' ? pairing.profileAId : winner === 'b' ? pairing.profileBId : null;

      const ratingA = await getOrDefaultRating(tx, pairing.profileAId);
      const ratingB = await getOrDefaultRating(tx, pairing.profileBId);
      const scoreForA = winner === 'draw' ? 0.5 : winner === 'a' ? 1 : 0;
      const scoreForB = winner === 'draw' ? 0.5 : winner === 'b' ? 1 : 0;
      const newRatingA = updateGlicko2(
        { rating: ratingA.glickoRating, rd: ratingA.glickoRd, vol: ratingA.glickoVol },
        [toGlickoGame({ rating: ratingB.glickoRating, rd: ratingB.glickoRd }, scoreForA)],
      );
      const newRatingB = updateGlicko2(
        { rating: ratingB.glickoRating, rd: ratingB.glickoRd, vol: ratingB.glickoVol },
        [toGlickoGame({ rating: ratingA.glickoRating, rd: ratingA.glickoRd }, scoreForB)],
      );

      await updatePairingConclusion(
        tx,
        pairing.id,
        {
          status: 'completed',
          scoreA,
          scoreB,
          edgeA,
          edgeB,
          winnerProfileId,
          verdict: { reason, scoreA, scoreB, winner, excludedQuestionIds },
          ratingAppliedAt: at,
        },
        at,
      );
      await updateRating(tx, pairing.profileAId, newRatingA, at);
      await updateRating(tx, pairing.profileBId, newRatingB, at);
      await incrementGamesCount(tx, pairing.profileAId, at);
      await incrementGamesCount(tx, pairing.profileBId, at);
    }

    await insertNeutralExitNotification(tx, pairing.profileAId, at);
    await insertNeutralExitNotification(tx, pairing.profileBId, at);

    return { outcome: anyGraded ? 'completed' : 'cancelled', pairingId: pairing.id };
  });
}

/** Finds `profileId`'s active pairing (if any) and applies the exit rule. No-op if none active. */
export async function applyPairingMidWeekExitForProfile(
  db: Db,
  profileId: string,
  reason: PairingExitReason,
  at: Date,
): Promise<PairingExitOutcome> {
  const pairing = await findActivePairingInvolving(db, profileId);
  if (!pairing) return { outcome: 'noop' };
  return applyPairingMidWeekExit(db, pairing, reason, at);
}
