/**
 * `grade:followup` (WS3-T3, §6.5): enqueued transactionally by `settlement:poll` (WS1-T5,
 * already implemented) right after grading. Runs percentile computation (§8.6, WS3-T5) and
 * reveal scheduling (§6.7, WS3-T4) for `daily` questions — it does NOT touch streaks itself
 * ("the publication rule ... defers all streak/record mutation to reveal firing", §6.5).
 *
 * For `nemesis_bonus` (added WS5-T1, since that's the first workstream to actually create these
 * questions — see the original SPEC-GAP(WS3-T3) this replaced): §8.8.1 "bonus questions have no
 * held reveal — grading publishes immediately via `grade:followup`" — no percentiles, no
 * `reveal:fire` wait/re-arm, just an immediate `locked` → `revealed` transition via the same
 * generic, idempotent `revealQuestionTx` the daily path eventually reaches through `reveal:fire`.
 *
 * `duo_bonus` remains a documented no-op — WS6 (duo) doesn't create those questions in this
 * wave either, so completing that branch is deferred to whichever task does (same reasoning the
 * original comment gave for nemesis_bonus).
 *
 * Idempotent: percentile computation is a pure overwrite (safe to re-run); reveal scheduling
 * just (re-)enqueues `reveal:fire`, which is itself idempotent (§5.7); `revealQuestionTx` only
 * transitions from `locked` with `settled_at IS NOT NULL`, so a redelivered nemesis_bonus run is
 * a no-op too — a worker restart between grading and this job (or between this job's steps)
 * always converges correctly on redelivery, satisfying the "kill-worker-between-grading-and-
 * followup recovers" AC.
 */
import type PgBoss from 'pg-boss';
import type { Redis } from 'ioredis';
import { now } from '@receipts/core';
import { getQuestionById, revealQuestionTx, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { computeAndCachePercentiles } from './percentiles.js';

export interface GradeFollowupJobData {
  questionId: string;
}

export async function runGradeFollowup(
  db: Db,
  redis: Redis,
  boss: PgBoss,
  questionId: string,
  at: Date = now(),
): Promise<void> {
  const question = await getQuestionById(db, questionId);
  if (!question) {
    logger.warn({ questionId }, 'grade:followup — question not found');
    return;
  }

  if (!question.settledAt) {
    // Defensive: grade:followup is only ever enqueued right after grading. Nothing to do yet.
    logger.warn({ questionId }, 'grade:followup — question not yet settled, skipping');
    return;
  }

  if (question.kind === 'nemesis_bonus') {
    const result = await revealQuestionTx(db, questionId, at);
    logger.info({ questionId, ...result }, 'grade:followup — nemesis_bonus published immediately (§8.8.1)');
    return;
  }

  if (question.kind !== 'daily') {
    logger.info(
      { questionId, kind: question.kind },
      'SPEC-GAP(WS3-T3/WS5-T1): non-daily, non-nemesis_bonus grade:followup is a no-op — duo bonus questions are not yet created by any workstream this wave',
    );
    return;
  }

  await computeAndCachePercentiles(db, redis, questionId);

  // §6.7 reveal scheduling: honors reveal_at, but never schedules in the past (a late-settling
  // market should reveal promptly once graded, not wait for an already-passed target).
  const target = question.revealAt.getTime() > at.getTime() ? question.revealAt : at;
  await boss.send('reveal:fire', { questionId }, { startAfter: target });
}

export const gradeFollowupHandler: JobHandler = async (ctx, data) => {
  const { questionId } = data as GradeFollowupJobData;
  await runGradeFollowup(ctx.db, ctx.redis, ctx.boss, questionId);
  logger.info({ questionId }, 'grade:followup complete');
};
