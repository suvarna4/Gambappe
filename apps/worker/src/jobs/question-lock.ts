/**
 * `question:lock` (WS3-T1, §5.3/§5.7, §6.2 lock job): `open` → `locked`, snapshotting
 * `crowd_yes_at_lock`/`crowd_no_at_lock` (bot-excluded) and `yes_price_at_lock`. Fired once per
 * question at `lock_at`. Price resolution reads cache/DB only — no live venue fetch (§6.2: the
 * lock job's price snapshot is "from cache/DB, same staleness rules"; the venue-fetch rung is
 * exclusive to the pick endpoint's narrow §2.2 exception). Revalidation is deferred —
 * SPEC-GAP(WS3-T1): the `/internal/revalidate` hook is WS8-T3 scope.
 */
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { cacheStalenessLimitS, now, stampPrice, type PriceStampSources } from '@receipts/core';
import {
  createDb,
  getMarketById,
  getPriceSnapshotNearest,
  getQuestionById,
  lockQuestionTx,
  type Db,
  type LockQuestionResult,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface QuestionLockJobData {
  questionId: string;
}

function priceCacheKey(venue: string, venueMarketId: string): string {
  return `price:${venue}:${venueMarketId}`;
}

/**
 * §5.7: "A late lock job back-fills the lock snapshot from picks with `picked_at < lock_at`
 * and the price snapshot nearest `lock_at`." The normal cache/DB-fallback ladder below is
 * relative to `at` (the fire time) — on a worker-outage late fire, `at` can be well after
 * `lockAt`, so a "fresh" cache/DB reading is fresh relative to NOW, not to lock time, and
 * would stamp the post-lock market price instead of the price actually at lock. Once the fire
 * is late enough that the ladder's own staleness window can no longer possibly straddle
 * `lockAt`, skip straight to the nearest recorded `market_price_snapshots` row instead.
 */
async function resolveLockPrice(
  db: Db,
  redis: Redis,
  marketId: string,
  isVolatile: boolean,
  lockAt: Date,
  at: Date,
): Promise<{ yesPrice: number } | null> {
  const market = await getMarketById(db, marketId);
  if (!market) return null;

  const lateByS = (at.getTime() - lockAt.getTime()) / 1000;
  if (lateByS > cacheStalenessLimitS(isVolatile)) {
    const nearest = await getPriceSnapshotNearest(db, marketId, lockAt);
    if (nearest) return { yesPrice: nearest.yesPrice };
    // No snapshot ever recorded for this market — fall through to the normal ladder as a
    // last resort rather than leaving yes_price_at_lock null outright.
  }

  const sources: PriceStampSources = {
    readCache: async () => {
      const raw = await redis.get(priceCacheKey(market.venue, market.venueMarketId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { yesPrice: number; ts: string };
      return { yesPrice: parsed.yesPrice, ts: new Date(parsed.ts) };
    },
    readDbFallback: async () => {
      if (market.yesPrice === null || market.yesPriceUpdatedAt === null) return null;
      return { yesPrice: market.yesPrice, ts: market.yesPriceUpdatedAt };
    },
    // No syncFetch rung — the lock job never makes a live venue call (§6.2 lock job).
  };

  const outcome = await stampPrice(sources, isVolatile, at);
  return outcome ? { yesPrice: outcome.yesPrice } : null;
}

export async function runQuestionLock(
  db: Db,
  pool: pg.Pool,
  redis: Redis,
  questionId: string,
  at: Date = now(),
): Promise<LockQuestionResult> {
  const question = await getQuestionById(db, questionId);
  if (!question) {
    logger.warn({ questionId }, 'question:lock — question not found');
    return { locked: false };
  }
  if (question.status !== 'open') {
    // Stale/duplicate fire — nothing to do (§5.7 idempotent transitions).
    return { locked: false };
  }

  const price = await resolveLockPrice(db, redis, question.marketId, question.isVolatile, question.lockAt, at);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Db = createDb(client);
    const result = await lockQuestionTx(tx, questionId, at, price);
    await client.query('COMMIT');
    // SPEC-GAP(WS3-T1): POST /internal/revalidate for the question/spectator pages is WS8-T3
    // scope (the endpoint doesn't exist yet) — skip the HTTP call.
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const questionLockHandler: JobHandler = async (ctx, data) => {
  const { questionId } = data as QuestionLockJobData;
  const result = await runQuestionLock(ctx.db, ctx.pool, ctx.redis, questionId);
  logger.info({ questionId, ...result }, 'question:lock complete');
};
