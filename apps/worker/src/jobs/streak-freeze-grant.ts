/**
 * `streak:freeze-grant` (WS3-T3, §6.6, Mondays 00:05 ET): +1 freeze (capped at
 * `STREAK_FREEZE_CAP`) for any profile that answered >= `FREEZE_EARN_MIN_DAYS` of the prior
 * `FREEZE_EARN_WINDOW_DAYS` daily questions (the just-completed Mon–Sun week, ET-anchored).
 * Never purchasable (INV-3) — this is the only path that increases `freeze_bank`.
 */
import type pg from 'pg';
import {
  FREEZE_EARN_MIN_DAYS,
  FREEZE_EARN_WINDOW_DAYS,
  STREAK_FREEZE_CAP,
  addDaysToDateString,
  etDateString,
  now,
} from '@receipts/core';
import { createDb, grantFreezeTx, listDailyQuestionIdsBetween, listFreezeGrantCandidates, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface FreezeGrantReport {
  windowStart: string;
  windowEnd: string;
  granted: number;
}

export async function runStreakFreezeGrant(db: Db, pool: pg.Pool, at: Date = now()): Promise<FreezeGrantReport> {
  const today = etDateString(at);
  const windowEnd = addDaysToDateString(today, -1); // the just-completed week's last day (Sunday)
  const windowStart = addDaysToDateString(windowEnd, -(FREEZE_EARN_WINDOW_DAYS - 1));

  const dailyIds = await listDailyQuestionIdsBetween(db, windowStart, windowEnd);
  const candidateIds = await listFreezeGrantCandidates(
    db,
    dailyIds,
    FREEZE_EARN_MIN_DAYS,
    STREAK_FREEZE_CAP,
    windowStart,
  );

  let granted = 0;
  for (const profileId of candidateIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = createDb(client);
      await grantFreezeTx(tx, profileId, STREAK_FREEZE_CAP, windowStart, at);
      await client.query('COMMIT');
      granted += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, profileId }, 'streak:freeze-grant failed for profile');
    } finally {
      client.release();
    }
  }

  return { windowStart, windowEnd, granted };
}

export const streakFreezeGrantHandler: JobHandler = async (ctx) => {
  const report = await runStreakFreezeGrant(ctx.db, ctx.pool);
  logger.info({ report }, 'streak:freeze-grant complete');
};
