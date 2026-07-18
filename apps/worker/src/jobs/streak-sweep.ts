/**
 * `streak:sweep` (WS3-T3, §6.6, daily 03:30 ET): advances/breaks streaks for profiles that did
 * NOT participate in the most recently settled daily — "keeps public profiles truthful even for
 * users who never return." Targets the single latest revealed/voided daily `question_date`
 * (recomputed fresh every run, so a worker outage or a delayed reveal is simply caught up on
 * the next run — no watermark to get out of sync, per the design doc's "only once D's daily is
 * revealed or voided; otherwise the sweep re-checks next run").
 *
 * A voided target day is handled correctly by composition, not a special case: nobody has an
 * "answered" (non-void) pick on a voided day, so every eligible profile is swept, and the final
 * `replayStreak` call inside `applyStreakForNonParticipant` already advances `last_counted_date`
 * across a voided day without incrementing (§6.6 "Voided day D") — see `streak-replay.ts`.
 *
 * SPEC-GAP(WS9-T3): `applyStreakForNonParticipant` can also newly consume a freeze (a
 * non-participant's gap gets bridged) — a second real trigger site for the `streak_freeze_used`
 * beat (§13.3), symmetric with `reveal:fire`'s participant case. WS9-T3's task scope explicitly
 * enumerated only `reveal:fire` for this beat, so it is not wired here; a follow-up task should
 * decide whether a silently-bridged non-participant should also be notified and, if so, hook
 * `applyStreakForNonParticipant`'s returned `freezeUsedForGap`/`freezeBankAfter` the same way
 * `reveal-fire.ts` does.
 */
import type pg from 'pg';
import { now } from '@receipts/core';
import {
  applyStreakForNonParticipant,
  createDb,
  getDailyQuestion,
  getLatestRevealedOrVoidedDailyDate,
  listRevealedOrVoidedDailyThrough,
  listStreakSweepCandidates,
  type Db,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface StreakSweepReport {
  targetDate: string | null;
  swept: number;
}

export async function runStreakSweep(db: Db, pool: pg.Pool, at: Date = now()): Promise<StreakSweepReport> {
  const targetDate = await getLatestRevealedOrVoidedDailyDate(db);
  if (!targetDate) return { targetDate: null, swept: 0 };

  const dailyQuestion = await getDailyQuestion(db, targetDate);
  if (!dailyQuestion) return { targetDate, swept: 0 }; // shouldn't happen; defensive

  const candidates = await listStreakSweepCandidates(db, dailyQuestion.id, targetDate);
  const dailyHistory = await listRevealedOrVoidedDailyThrough(db, targetDate);

  let swept = 0;
  for (const candidate of candidates) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = createDb(client);
      await applyStreakForNonParticipant(tx, candidate.profileId, dailyHistory, targetDate, at);
      await client.query('COMMIT');
      swept += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, profileId: candidate.profileId }, 'streak:sweep failed for profile');
    } finally {
      client.release();
    }
  }

  return { targetDate, swept };
}

export const streakSweepHandler: JobHandler = async (ctx) => {
  const report = await runStreakSweep(ctx.db, ctx.pool);
  logger.info({ report }, 'streak:sweep complete');
};
