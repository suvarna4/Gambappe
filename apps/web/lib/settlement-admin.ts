/**
 * Admin settlement/void/regrade overrides (§15.3, §6.5, WS10-T3). Three admin actions on a
 * single question:
 *
 *  - **Force-settle**: admin supplies the outcome for a `locked` question whose market closed
 *    at least `FORCE_SETTLE_MIN_AFTER_CLOSE_MIN` ago. Runs the exact standard grading pipeline
 *    (`gradeResolvedQuestionTx`, the same function `settlement:poll` itself uses) then enqueues
 *    `grade:followup` — non-transactionally, mirroring `wallet-queue.ts`'s established
 *    cross-process enqueue precedent (`apps/web` → `apps/worker`; the same-transaction enqueue
 *    trick `settlement-poll.ts` uses only works same-process).
 *  - **Void**: admin voids a question with a reason. Pre-reveal (`scheduled|open|locked`) never
 *    needs a streak replay — §6.6: "all streak mutation happens at reveal time or later," so a
 *    question that never reached `revealed` never mutated any streak. Post-reveal (`revealed`,
 *    within `REGRADE_WINDOW_H`) voids every pick and replays every affected profile's streak
 *    from scratch (§6.6 replay procedure).
 *  - **Regrade**: admin flips an already-settled outcome within `REGRADE_WINDOW_H`. Re-scores
 *    every pick, recomputes the cached percentile hash, and replays every affected profile's
 *    streak (win-streak fields specifically, since participation itself doesn't change).
 *
 * Scope (documented, matching `grade:followup`'s own precedent): regrade and the post-reveal
 * void path only handle DAILY questions. Nemesis/duo bonus questions don't exist in this wave
 * — no workstream creates `kind='nemesis_bonus'|'duo_bonus'` rows yet — so "any pairing/duo
 * scoring that consumed it" (§6.5) and the deep-regrade rating-restoration path (restoring
 * `nemesis_pairings.verdict.rating_before` etc. once ratings were applied for a period) have
 * nothing to restore against. Refusing non-daily regrade here is deliberate: silently
 * under-scoring a future pairing/match would be worse than a clear "not implemented yet" error.
 *
 * Every mutation is audited by the route layer via `withAdminAudit` (§15.1), not here.
 */
import type { Redis } from 'ioredis';
import { ApiError, FORCE_SETTLE_MIN_AFTER_CLOSE_MIN, REGRADE_WINDOW_H, now } from '@receipts/core';
import {
  gradeResolvedQuestionTx,
  getMarketById,
  getQuestionById,
  regradeRevealedQuestionTx,
  replayStreakForProfileTx,
  sendNotification,
  voidAllPicksForQuestionTx,
  voidQuestionTx,
  voidRevealedQuestionTx,
  type Db,
} from '@receipts/db';
import { recomputeAndCache } from './percentile';
import { getBoss } from './stores';

const GRADE_FOLLOWUP_QUEUE = 'grade:followup';

export interface ForceSettleResult {
  graded: boolean;
  winCount: number;
  lossCount: number;
}

/** §15.3: "force-settle (pick outcome; requires typing the outcome; used when poller lags a
 * confirmed real-world result — allowed only ≥ FORCE_SETTLE_MIN_AFTER_CLOSE_MIN after venue
 * market close)." The "requires typing the outcome" confirmation is a UI affordance — the API
 * contract is simply "the outcome parameter" like any other settlement path. */
export async function forceSettleQuestion(
  db: Db,
  questionId: string,
  outcome: 'yes' | 'no',
  at: Date = now(),
): Promise<ForceSettleResult> {
  const question = await getQuestionById(db, questionId);
  if (!question) throw new ApiError('NOT_FOUND', 'question not found');
  if (question.status !== 'locked') {
    throw new ApiError('VALIDATION_FAILED', 'force-settle requires a locked question');
  }

  const market = await getMarketById(db, question.marketId);
  if (!market) throw new ApiError('NOT_FOUND', 'market not found');
  const minSettleAt = new Date(market.closeTime.getTime() + FORCE_SETTLE_MIN_AFTER_CLOSE_MIN * 60_000);
  if (at < minSettleAt) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `force-settle is allowed only ${FORCE_SETTLE_MIN_AFTER_CLOSE_MIN} minutes after market close`,
    );
  }

  const result = await db.transaction((tx) => gradeResolvedQuestionTx(tx, questionId, outcome, at));
  if (result.graded) {
    const boss = await getBoss();
    await boss.createQueue(GRADE_FOLLOWUP_QUEUE);
    await boss.send(GRADE_FOLLOWUP_QUEUE, { questionId });
  }
  return { graded: result.graded, winCount: result.winCount, lossCount: result.lossCount };
}

export interface VoidQuestionAdminResult {
  voided: boolean;
  affectedProfileIds: string[];
}

export async function voidQuestionAdmin(
  db: Db,
  questionId: string,
  reason: string,
  at: Date = now(),
): Promise<VoidQuestionAdminResult> {
  const question = await getQuestionById(db, questionId);
  if (!question) throw new ApiError('NOT_FOUND', 'question not found');

  if (question.status === 'revealed') {
    if (!question.revealedAt) throw new ApiError('INTERNAL', 'revealed question missing revealed_at');
    const hoursSinceReveal = (at.getTime() - question.revealedAt.getTime()) / 3_600_000;
    if (hoursSinceReveal > REGRADE_WINDOW_H) {
      throw new ApiError('VALIDATION_FAILED', `post-reveal void is only allowed within ${REGRADE_WINDOW_H}h of reveal`);
    }

    const affectedProfileIds = await db.transaction(async (tx) => {
      const voidResult = await voidRevealedQuestionTx(tx, questionId, at, reason);
      if (!voidResult.voided) return [];
      const picksResult = await voidAllPicksForQuestionTx(tx, questionId, at);
      for (const profileId of picksResult.affectedProfileIds) {
        await replayStreakForProfileTx(tx, profileId, at);
      }
      return picksResult.affectedProfileIds;
    });

    // Best-effort, outside the tx — matches wallet:ingest's non-transactional enqueue posture.
    // No narrate() beat exists for this yet (WS9-T3 beat wiring isn't built) — a bare `line`
    // still renders fine per the email template's documented fallback contract.
    for (const profileId of affectedProfileIds) {
      await sendNotification(
        db,
        profileId,
        'question_voided',
        { line: 'A question you answered was voided after review — it no longer counts for or against your streak.' },
        'email',
        null,
        at,
      ).catch(() => {});
    }

    return { voided: true, affectedProfileIds };
  }

  const result = await db.transaction((tx) => voidQuestionTx(tx, questionId, at, reason));
  return { voided: result.voided, affectedProfileIds: [] };
}

export interface RegradeQuestionResult {
  regraded: boolean;
  affectedProfileIds: string[];
}

export async function regradeQuestion(
  db: Db,
  redis: Redis,
  questionId: string,
  newOutcome: 'yes' | 'no',
  at: Date = now(),
): Promise<RegradeQuestionResult> {
  const question = await getQuestionById(db, questionId);
  if (!question) throw new ApiError('NOT_FOUND', 'question not found');
  if (question.status !== 'revealed') {
    throw new ApiError('VALIDATION_FAILED', 'regrade requires a revealed question');
  }
  if (!question.revealedAt) throw new ApiError('INTERNAL', 'revealed question missing revealed_at');
  const hoursSinceReveal = (at.getTime() - question.revealedAt.getTime()) / 3_600_000;
  if (hoursSinceReveal > REGRADE_WINDOW_H) {
    throw new ApiError('VALIDATION_FAILED', `regrade is only allowed within ${REGRADE_WINDOW_H}h of reveal`);
  }
  if (question.kind !== 'daily') {
    // SPEC-GAP(ws10-t3): see file header — nemesis/duo bonus questions don't exist yet.
    throw new ApiError('VALIDATION_FAILED', 'regrade is only implemented for daily questions in this wave');
  }
  if (question.outcome === newOutcome) {
    throw new ApiError('VALIDATION_FAILED', 'new outcome matches the current outcome — nothing to regrade');
  }

  const affectedProfileIds = await db.transaction(async (tx) => {
    const result = await regradeRevealedQuestionTx(tx, questionId, newOutcome, at);
    if (!result.regraded) return [];
    for (const profileId of result.affectedProfileIds) {
      await replayStreakForProfileTx(tx, profileId, at);
    }
    return result.affectedProfileIds;
  });

  if (affectedProfileIds.length > 0) {
    await recomputeAndCache(db, redis, questionId);
  }

  for (const profileId of affectedProfileIds) {
    await sendNotification(
      db,
      profileId,
      'question_regraded',
      { line: 'A question you answered was corrected after review — your result may have changed.' },
      'email',
      null,
      at,
    ).catch(() => {});
  }

  return { regraded: affectedProfileIds.length > 0, affectedProfileIds };
}
