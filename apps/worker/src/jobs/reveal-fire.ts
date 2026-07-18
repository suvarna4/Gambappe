/**
 * `reveal:fire` (WS3-T4, §6.7): fires at `max(reveal_at, settlement_time)`. Scheduled per-
 * question at `reveal_at` (`scheduleQuestionLifecycle`, WS3-T1) and re-enqueued promptly by
 * `grade:followup` after a late grading (WS3-T3) — either instance converges on the same
 * idempotent outcome (§5.7).
 *
 * On fire: if not yet settled, re-arms itself every `REVEAL_REARM_MIN`; past
 * `REVEAL_MAX_DELAY_H` it also logs an admin-alert placeholder (SPEC-GAP(WS3-T4): no admin
 * channel exists yet, WS10) but keeps re-arming rather than dropping the question silently.
 *
 * On settle: ONE transaction flips `locked` → `revealed` AND applies the §6.6 daily-day streak
 * increment (gap rule + `current_streak += 1`) for every profile with a graded pick that day,
 * via `applyStreakForParticipant` (reusing WS2-T3's `streak-replay.ts`, not re-derived here) —
 * single transaction so a crash mid-run rolls back cleanly and a redelivery reprocesses from
 * scratch (never a partially-applied reveal). "Called it" badge (§6.7: win AND implied entry
 * probability ≤ `LONGSHOT_THRESHOLD`) is detected here and written to `analytics_events`
 * (WS3-T6) — notification DISPATCH is WS9 scope (SPEC-GAP, logged only). Revalidation is
 * SPEC-GAP(WS3-T4): `/internal/revalidate` is WS8-T3 scope.
 *
 * Daily ordering assert (§6.6: "reveal:fire for daily D never fires before D−1's daily is
 * revealed or voided"): if the prior calendar day's daily exists and hasn't settled into
 * revealed/voided yet, this run re-arms instead of proceeding — defensive; the structural
 * guarantee (REVEAL_MAX_DELAY_H + admin escalation) should make this unreachable in practice.
 */
import type pg from 'pg';
import type PgBoss from 'pg-boss';
import { REVEAL_MAX_DELAY_H, REVEAL_REARM_MIN, now } from '@receipts/core';
import { isCalledIt } from '@receipts/engine';
import {
  applyStreakForParticipant,
  createDb,
  getGradedPicksForQuestion,
  getPriorDayDailyQuestion,
  getQuestionById,
  insertAnalyticsEvent,
  listRevealedOrVoidedDailyThrough,
  revealQuestionTx,
  type Db,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface RevealFireJobData {
  questionId: string;
}

function impliedEntryProb(side: 'yes' | 'no', yesPriceAtEntry: number): number {
  return side === 'yes' ? yesPriceAtEntry : 1 - yesPriceAtEntry;
}

export type RevealFireOutcome =
  | { status: 'not_found' }
  | { status: 'noop' } // already revealed/voided/otherwise not eligible
  | { status: 're_armed'; nextAttemptAt: Date }
  | { status: 'revealed'; participantCount: number; calledItCount: number };

export async function runRevealFire(
  db: Db,
  pool: pg.Pool,
  boss: PgBoss,
  questionId: string,
  at: Date = now(),
): Promise<RevealFireOutcome> {
  const question = await getQuestionById(db, questionId);
  if (!question) {
    logger.warn({ questionId }, 'reveal:fire — question not found');
    return { status: 'not_found' };
  }
  if (question.status !== 'locked') {
    return { status: 'noop' }; // already revealed/voided, or never locked — idempotent no-op
  }

  const reArm = async (reason: string): Promise<RevealFireOutcome> => {
    const overdueH = (at.getTime() - question.revealAt.getTime()) / 3_600_000;
    if (overdueH > REVEAL_MAX_DELAY_H) {
      logger.warn(
        { questionId, overdueH, reason },
        'SPEC-GAP(WS3-T4): reveal past REVEAL_MAX_DELAY_H — would page admin channel (WS10, not built yet)',
      );
    }
    const nextAttemptAt = new Date(at.getTime() + REVEAL_REARM_MIN * 60_000);
    await boss.send('reveal:fire', { questionId }, { startAfter: nextAttemptAt });
    return { status: 're_armed', nextAttemptAt };
  };

  if (!question.settledAt) {
    return reArm('not_settled');
  }
  if (question.questionDate) {
    const prior = await getPriorDayDailyQuestion(db, question.questionDate);
    if (prior && prior.status !== 'revealed' && prior.status !== 'voided') {
      return reArm('prior_day_not_settled');
    }
  }

  const gradedPicks = await getGradedPicksForQuestion(db, questionId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Db = createDb(client);

    const revealResult = await revealQuestionTx(tx, questionId, at);
    if (!revealResult.revealed) {
      await client.query('ROLLBACK');
      return { status: 'noop' }; // lost a race with another instance — already revealed
    }

    let calledItCount = 0;
    if (question.questionDate) {
      const dailyHistory = await listRevealedOrVoidedDailyThrough(tx, question.questionDate);
      for (const gp of gradedPicks) {
        await applyStreakForParticipant(tx, gp.profileId, dailyHistory, question.questionDate, at);

        const calledIt = gp.result === 'win' && isCalledIt(impliedEntryProb(gp.side, gp.yesPriceAtEntry));
        if (calledIt) {
          calledItCount += 1;
          await insertAnalyticsEvent(tx, {
            ts: at,
            event: 'called_it',
            profileId: gp.profileId,
            props: { question_id: questionId, side: gp.side, yes_price_at_entry: gp.yesPriceAtEntry },
          });
        }
      }
    }

    await client.query('COMMIT');

    // SPEC-GAP(WS3-T4): reveal notifications (§13) are WS9 scope — not dispatched here.
    // SPEC-GAP(WS3-T4): POST /internal/revalidate for the question/spectator pages is WS8-T3
    // scope (the endpoint doesn't exist yet) — skip the HTTP call.

    return { status: 'revealed', participantCount: gradedPicks.length, calledItCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const revealFireHandler: JobHandler = async (ctx, data) => {
  const { questionId } = data as RevealFireJobData;
  const outcome = await runRevealFire(ctx.db, ctx.pool, ctx.boss, questionId);
  logger.info({ questionId, outcome }, 'reveal:fire complete');
};
