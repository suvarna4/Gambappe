/**
 * Reports + blocks orchestration (design doc §14.3, §5.7, WS11-T3). Route handlers stay thin;
 * this is where the auto-pause count-and-flip and the pairing mid-week exit rule live, both
 * of which need multiple repository calls plus (for an early conclusion) `packages/engine`'s
 * pure scoring/rating math.
 */
import { uuidv7 } from 'uuidv7';
import { updateGlicko2, scoreNemesisWeek, type GlickoGame } from '@receipts/engine';
import {
  addDaysToDateString,
  AUTOPAUSE_REPORT_N,
  AUTOPAUSE_REPORT_WINDOW_D,
  BOT_EXCLUDE_THRESHOLD,
  REPORTER_MIN_ACCOUNT_AGE_D,
} from '@receipts/core';
import {
  countQualifiedReportersSince,
  findActivePairingInvolving,
  getFullPairingSharedQuestionPicks,
  getOrDefaultRating,
  incrementGamesCount,
  insertBlock,
  insertNeutralExitNotification,
  insertReport,
  updatePairingConclusion,
  updateProfileById,
  updateRating,
  type Db,
  type NewReportRow,
} from '@receipts/db';
import { applyDuoMidWindowExit } from './duo-match-lifecycle';

function daysAgo(at: Date, days: number): Date {
  return new Date(at.getTime() - days * 24 * 3600_000);
}

export interface SubmitReportInput {
  reporterProfileId: string;
  reportedProfileId: string | null;
  contextKind: NewReportRow['contextKind'];
  contextId: string;
  reason: NewReportRow['reason'];
  note?: string | null;
}

/**
 * Inserts the report, then — only when it names a `reportedProfileId` — recounts qualified
 * reporters within the trailing `AUTOPAUSE_REPORT_WINDOW_D` days and flips the reported
 * profile to `paused_matchmaking` the moment the count reaches `AUTOPAUSE_REPORT_N` (idempotent:
 * re-flipping an already-paused profile is a no-op update, and once paused the profile stays
 * paused until an admin resolves it — this never un-pauses on a stale recount).
 */
export async function submitReport(db: Db, input: SubmitReportInput, at: Date): Promise<{ reportId: string; autoPaused: boolean }> {
  return db.transaction(async (tx) => {
    const report = await insertReport(tx, {
      id: uuidv7(),
      reporterProfileId: input.reporterProfileId,
      reportedProfileId: input.reportedProfileId,
      contextKind: input.contextKind,
      contextId: input.contextId,
      reason: input.reason,
      note: input.note ?? null,
    });

    let autoPaused = false;
    if (input.reportedProfileId) {
      const qualifiedCount = await countQualifiedReportersSince(
        tx,
        input.reportedProfileId,
        daysAgo(at, AUTOPAUSE_REPORT_WINDOW_D),
        daysAgo(at, REPORTER_MIN_ACCOUNT_AGE_D),
        BOT_EXCLUDE_THRESHOLD,
      );
      if (qualifiedCount >= AUTOPAUSE_REPORT_N) {
        await updateProfileById(tx, input.reportedProfileId, { status: 'paused_matchmaking' });
        autoPaused = true;
      }
    }

    return { reportId: report.id, autoPaused };
  });
}

function toGlickoGame(opponent: { rating: number; rd: number }, score: 0 | 0.5 | 1): GlickoGame {
  return { opponentRating: opponent.rating, opponentRd: opponent.rd, score };
}

/**
 * §14.3/§5.7: blocking cancels the blocked profile's active pairing outright if no shared
 * question has graded yet; otherwise the pairing concludes early, scored on graded questions
 * only via the same pure `scoreNemesisWeek`/`updateGlicko2` functions the (not-yet-built)
 * `nemesis:conclude` job will use for its normal Sunday conclusion — so a block never erases
 * a pairing a player is already losing. Both sides get the neutral exit notification either way.
 * Applies the SAME rule to the blocked profile's active DUO match, if any (§5.7: "mid-window
 * exits follow the same early-conclusion rule as pairings", WS6-T2's
 * `applyDuoMidWindowExit`) — a profile can have at most one active pairing AND one active duo
 * match at once, so both checks always run, independently, on every block.
 */
export async function applyBlock(db: Db, blockerProfileId: string, blockedProfileId: string, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await insertBlock(tx, blockerProfileId, blockedProfileId);

    // Nested transaction (Postgres SAVEPOINT, drizzle-orm) — same pattern as
    // `packages/db/src/repositories/picks.ts`'s `placePickTx` — so the duo-match exit commits
    // atomically with the block + pairing exit below rather than as an independent transaction.
    await applyDuoMidWindowExit(tx, blockedProfileId, at);

    const pairing = await findActivePairingInvolving(tx, blockedProfileId);
    if (!pairing) return;

    // The FULL shared set — the week's derived dailies UNION the pairing's bonus questions —
    // matching `nemesis:conclude` and the worker's `pairing-lifecycle.ts` exactly. The original
    // bonus-only `getPairingSharedQuestionPicks` silently missed the dailies (7 vs 0–3 bonus in
    // a real week), so a block could cancel a pairing the blocker was already losing on daily
    // questions — the precise "erase a losing week" hole §5.7/§14.3 exist to close (flagged as a
    // fast-follow in WS5-T1's PR when the corrected function landed).
    const weekEnd = addDaysToDateString(pairing.weekStart, 6);
    const sharedQuestions = await getFullPairingSharedQuestionPicks(
      tx,
      { id: pairing.id, weekStart: pairing.weekStart, weekEnd },
      pairing.profileAId,
      pairing.profileBId,
    );
    const anyGraded = sharedQuestions.some((q) => q.isSettled && !q.isVoid);

    if (!anyGraded) {
      await updatePairingConclusion(tx, pairing.id, { status: 'cancelled' }, at);
    } else {
      const { scoreA, scoreB, edgeA, edgeB, winner } = scoreNemesisWeek(
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
          verdict: { reason: 'mid_week_exit', scoreA, scoreB, winner },
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
  });
}
