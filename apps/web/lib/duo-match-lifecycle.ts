/**
 * Duo match mid-window exit (design doc §5.7, §8.9, WS6-T2) — mirrors
 * `apps/web/lib/moderation.ts`'s nemesis-pairing `applyBlock` precedent (WS11-T3) for duo
 * matches: block, admin suspend, and self-service account deletion all funnel through
 * `applyDuoMidWindowExit` for whichever profile triggered the event. If NO shared question has
 * graded yet, the match is cancelled with no rating effect; if ≥1 has graded, the match
 * concludes immediately (scored on graded questions only) with normal rating application — so a
 * losing duo can't erase a loss by having one member block/get suspended/delete their account
 * (the same integrity rule §14.3 states for nemesis).
 *
 * `packages/db` has no `@receipts/engine` dependency (§4.2), so the scoring/rating math lives
 * here, not in `packages/db/src/repositories/duo-matches.ts`. That also means this file has its
 * own small chemistry-refresh helper rather than importing
 * `apps/worker/src/jobs/duo-match-completion.ts`'s near-identical one: apps/web and apps/worker
 * can't import each other's code (`packages/db/src/repositories/notifications.ts`'s header note
 * documents this exact constraint for `sendNotification`, which is why that function lives in
 * `packages/db` instead).
 */
import { computeDuoSynergy, scoreDuoMatch, updateGlicko2, type GlickoGame } from '@receipts/engine';
import {
  computeLifetimeAccuracy,
  findActiveOrScheduledMatchForProfile,
  getDuoById,
  getDuoLifetimeSlots,
  getDuoMatchScoringInput,
  incrementDuoMatchesPlayed,
  sendNotification,
  updateDuoChemistry,
  updateDuoMatchConclusion,
  updateDuoRating,
  type Db,
  type DuoRow,
} from '@receipts/db';

function toGlickoGame(opponent: { rating: number; rd: number }, score: 0 | 0.5 | 1): GlickoGame {
  return { opponentRating: opponent.rating, opponentRd: opponent.rd, score };
}

/** Small, intentional duplicate of `apps/worker/src/jobs/duo-match-completion.ts`'s
 * `refreshDuoChemistry` — see file header for why. */
async function refreshDuoChemistry(db: Db, duoId: string, at: Date): Promise<void> {
  const duo = await getDuoById(db, duoId);
  if (!duo) return;
  const slots = await getDuoLifetimeSlots(db, duoId);
  if (slots.length === 0) return;

  const [accuracyA, accuracyB] = await Promise.all([
    computeLifetimeAccuracy(db, duo.profileAId),
    computeLifetimeAccuracy(db, duo.profileBId),
  ]);
  const { jointHitRate, synergy } = computeDuoSynergy({
    slots,
    partnerAAccuracy: accuracyA,
    partnerBAccuracy: accuracyB,
  });
  await updateDuoChemistry(db, duoId, jointHitRate, synergy, at);
}

/**
 * §5.7 mid-window exit for `profileId`'s active duo match, if any — a no-op if the profile has
 * no active duo, or the duo has no currently `scheduled`/`active` match. Callers: `applyBlock`
 * (`apps/web/lib/moderation.ts`, for the BLOCKED profile — mirrors that function's own
 * blocked-profile-only scope for the nemesis pairing check), the admin `suspend` report-resolve
 * action (the reported profile), and `DELETE /api/v1/me` (the deleting profile).
 */
export async function applyDuoMidWindowExit(db: Db, profileId: string, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await findActiveOrScheduledMatchForProfile(tx, profileId);
    if (!found) return;
    const { match } = found;

    const [duoA, duoB] = await Promise.all([getDuoById(tx, match.duoAId), getDuoById(tx, match.duoBId)]);
    if (!duoA || !duoB) return; // shouldn't happen — duos are never hard-deleted (§11.4-style guarantee)

    const scoring = await getDuoMatchScoringInput(tx, match.id);
    const anyGraded = scoring.some((q) => q.isSettled && !q.isVoid);

    if (!anyGraded) {
      await updateDuoMatchConclusion(tx, match.id, { status: 'cancelled' }, at);
    } else {
      const { scoreA, scoreB, winner } = scoreDuoMatch(scoring);
      const winnerDuoId = winner === 'a' ? match.duoAId : winner === 'b' ? match.duoBId : null;

      const scoreForA = winner === 'draw' ? 0.5 : winner === 'a' ? 1 : 0;
      const scoreForB = winner === 'draw' ? 0.5 : winner === 'b' ? 1 : 0;
      const newRatingA = updateGlicko2(
        { rating: duoA.glickoRating, rd: duoA.glickoRd, vol: duoA.glickoVol },
        [toGlickoGame({ rating: duoB.glickoRating, rd: duoB.glickoRd }, scoreForA)],
      );
      const newRatingB = updateGlicko2(
        { rating: duoB.glickoRating, rd: duoB.glickoRd, vol: duoB.glickoVol },
        [toGlickoGame({ rating: duoA.glickoRating, rd: duoA.glickoRd }, scoreForB)],
      );

      await updateDuoMatchConclusion(
        tx,
        match.id,
        { status: 'completed', scoreA, scoreB, winnerDuoId, ratingAppliedAt: at },
        at,
      );
      await updateDuoRating(tx, match.duoAId, newRatingA, at);
      await updateDuoRating(tx, match.duoBId, newRatingB, at);
      await incrementDuoMatchesPlayed(tx, match.duoAId, at);
      await incrementDuoMatchesPlayed(tx, match.duoBId, at);
    }

    await refreshDuoChemistry(tx, match.duoAId, at);
    await refreshDuoChemistry(tx, match.duoBId, at);

    // SPEC-GAP(ws6-t2): §13.3's beat catalog (exact `kind` names/payload shapes) isn't in this
    // task's reading scope — `kind: 'duo_match_ended_early'` is a placeholder mirroring
    // nemesis's `pairing_ended_early` (moderation.ts's `insertNeutralExitNotification`); WS9-T3
    // should confirm/rename it against the real catalog when it lands.
    const members: Array<DuoRow['profileAId']> = [duoA.profileAId, duoA.profileBId, duoB.profileAId, duoB.profileBId];
    for (const memberId of members) {
      await sendNotification(
        tx,
        memberId,
        'duo_match_ended_early',
        { match_id: match.id },
        'email',
        `duo_match_ended_early:${match.id}:${memberId}`,
        at,
      );
    }
  });
}
