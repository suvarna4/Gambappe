/**
 * `grade:followup` (WS3-T3, §6.5): enqueued transactionally by `settlement:poll` (WS1-T5,
 * already implemented) right after grading. Runs percentile computation (§8.6, WS3-T5) and
 * reveal scheduling (§6.7, WS3-T4) — it does NOT touch streaks itself ("the publication rule
 * ... defers all streak/record mutation to reveal firing", §6.5). For non-`daily` kinds
 * (nemesis/duo bonus questions, §8.8.1 "publish immediately") — SPEC-GAP(WS3-T3): no
 * workstream in this wave creates `nemesis_bonus`/`duo_bonus` questions yet, so that branch is
 * a documented no-op rather than a half-built immediate-publish path.
 *
 * Idempotent: percentile computation is a pure overwrite (safe to re-run); reveal scheduling
 * just (re-)enqueues `reveal:fire`, which is itself idempotent (§5.7) — so a worker restart
 * between grading and this job (or between this job's two steps) always converges correctly
 * on redelivery, satisfying the "kill-worker-between-grading-and-followup recovers" AC.
 */
import type PgBoss from 'pg-boss';
import type { Redis } from 'ioredis';
import { now } from '@receipts/core';
import { getQuestionById, type Db } from '@receipts/db';
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

  if (question.kind !== 'daily') {
    logger.info(
      { questionId, kind: question.kind },
      'SPEC-GAP(WS3-T3): non-daily grade:followup is a no-op — nemesis/duo bonus questions are not yet created by any workstream this wave',
    );
    return;
  }

  if (!question.settledAt) {
    // Defensive: grade:followup is only ever enqueued right after grading. Nothing to do yet.
    logger.warn({ questionId }, 'grade:followup — question not yet settled, skipping');
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
