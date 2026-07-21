/**
 * `grade:followup` (WS3-T3, §6.5; WS19-T1 amendment): enqueued transactionally by
 * `settlement:poll` (WS1-T5) right after grading. For `daily` questions: percentile computation
 * (§8.6, WS3-T5) then — per D-J3 ("settlement follows reality") — SETTLE IN THE SAME TICK via
 * `settleQuestion` (`../lib/settle-question.ts`), instead of scheduling a `reveal:fire` at the
 * question's `reveal_at` clock time. The synchronized clock-scheduled reveal ceremony is cut: a
 * question settles the moment its market resolves, any time of day. `settleQuestion` owns the
 * streak/record mutation the §6.5 publication rule used to defer to reveal firing.
 *
 * For `nemesis_bonus` (WS5-T1) and `duo_bonus` (WS6-T2) — §8.8.1 "bonus questions have no held
 * reveal — grading publishes immediately via `grade:followup`": both reveal immediately (no
 * percentile/streak machinery — those are daily-only, §6.6/§8.6) via the same generic, idempotent
 * `revealQuestionTx`. `duo_bonus` additionally checks completion for every `duo_matches` row that
 * references this question as a bonus question (`listOpenMatchIdsForBonusQuestion`,
 * `duo-match-completion.ts`) — `nemesis_bonus` has no equivalent hook (nemesis week scoring,
 * WS5-T3, reads shared-question picks directly rather than needing a per-question completion check).
 *
 * Idempotent: percentile computation is a pure overwrite (safe to re-run); `settleQuestion`,
 * `revealQuestionTx` and `tryCompleteDuoMatch` are all status-guarded no-ops on a re-run — so a
 * worker restart anywhere in this job (daily, nemesis_bonus, or duo_bonus) always converges
 * correctly on redelivery, satisfying the "kill-worker-between-grading-and-followup recovers" AC.
 */
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { now } from '@receipts/core';
import { getQuestionById, listOpenMatchIdsForBonusQuestion, revealQuestionTx, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { computeAndCachePercentiles } from './percentiles.js';
import { tryCompleteDuoMatch } from './duo-match-completion.js';
import { settleQuestion } from '../lib/settle-question.js';

export interface GradeFollowupJobData {
  questionId: string;
}

async function runDuoBonusFollowup(db: Db, questionId: string, at: Date): Promise<void> {
  await revealQuestionTx(db, questionId, at); // no-op if already revealed (§5.7 status guard)

  const matchIds = await listOpenMatchIdsForBonusQuestion(db, questionId);
  for (const matchId of matchIds) {
    await tryCompleteDuoMatch(db, matchId, at);
  }
}

export async function runGradeFollowup(
  db: Db,
  pool: pg.Pool,
  redis: Redis,
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

  if (question.kind === 'duo_bonus') {
    await runDuoBonusFollowup(db, questionId, at);
    return;
  }

  if (question.kind !== 'daily') {
    // Unreachable in practice — §5.1's question_kind enum is daily|nemesis_bonus|duo_bonus and
    // all three are now handled above; kept as a defensive fallback rather than an assertion.
    logger.warn({ questionId, kind: question.kind }, 'grade:followup — unrecognized question kind, no-op');
    return;
  }

  await computeAndCachePercentiles(db, redis, questionId);

  // D-J3 (WS19-T1): settle in the same tick — the clock-scheduled reveal ceremony is cut. A daily
  // settles the moment its market resolves; `settleQuestion` flips `locked` → `revealed`, applies
  // the §6.6 streak increment, fires the settle push + ISR revalidate. Idempotent on redelivery.
  const outcome = await settleQuestion(db, pool, questionId, at);
  logger.info({ questionId, outcome }, 'grade:followup — daily settled on resolution (D-J3)');
}

export const gradeFollowupHandler: JobHandler = async (ctx, data) => {
  const { questionId } = data as GradeFollowupJobData;
  await runGradeFollowup(ctx.db, ctx.pool, ctx.redis, questionId);
  logger.info({ questionId }, 'grade:followup complete');
};
