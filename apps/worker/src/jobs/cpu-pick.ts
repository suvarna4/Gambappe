/**
 * `cpu:pick` (WS26-T5, docs/plans/cpu-nemesis-wbs.md): the CPU rivals' pick sweep. A CRON
 * SWEEP, deliberately not event-triggered (review correction 1): bonus questions are created
 * already-`open` by `nemesis:assign` — `question:open` never fires for them, so an
 * open-triggered job would silently skip half of every CPU matchup. The sweep also gives
 * "The Clock" its late picks: `decideCpuPick` returns `wait` until inside its pick window,
 * and the next tick re-asks.
 *
 * Integrity (the plan's non-negotiables):
 * - Pre-lock, real price, no lookahead: the price is the same cache→DB `stampPrice` ladder
 *   the lock job uses (no live venue rung, same posture as `question:lock`), and the pick
 *   goes through `placePickTx` — whose guarded UPDATE re-checks `status='open' AND
 *   lock_at > now()` in the DB, so a sweep racing the lock can never place late.
 * - Raw `yes_count`/`no_count` DO increment for CPU picks (placePickTx's counter is the
 *   §6.2 serialization point) — harmless by construction: those counters are never exposed
 *   pre-lock (§9.3), and the crowd-at-lock snapshot bot-filters CPUs out (pinned WS26-T7).
 * - Idempotent: the picks unique constraint + `already_picked` outcome make a duplicate
 *   sweep tick a no-op; `skip` decisions are stable (re-asking yields skip again).
 */
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { isFlagEnabled, now, stampPrice, type PriceStampSources } from '@receipts/core';
import {
  getMarketById,
  getQuestionById,
  listActiveCpuPairingsWithOpenQuestion,
  placePickTx,
  type Db,
} from '@receipts/db';
import { decideCpuPick } from '@receipts/engine';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

function priceCacheKey(venue: string, venueMarketId: string): string {
  return `price:${venue}:${venueMarketId}`;
}

export interface CpuPickSweepReport {
  targets: number;
  picked: number;
  waited: number;
  skipped: number;
  priceUnavailable: number;
  raced: number;
}

export async function runCpuPickSweep(
  db: Db,
  redis: Redis,
  at: Date = now(),
): Promise<CpuPickSweepReport> {
  const targets = await listActiveCpuPairingsWithOpenQuestion(db);
  const report: CpuPickSweepReport = {
    targets: targets.length,
    picked: 0,
    waited: 0,
    skipped: 0,
    priceUnavailable: 0,
    raced: 0,
  };

  for (const target of targets) {
    const question = await getQuestionById(db, target.questionId);
    const market = await getMarketById(db, target.marketId);
    if (!question || !market) continue;

    // Same two-rung ladder as question:lock — cache, then the market row's last-synced price.
    // No live venue rung: the sweep re-fires in minutes, so a stale window just defers the
    // pick one tick rather than warranting a synchronous fetch.
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
    };
    const stamp = await stampPrice(sources, question.isVolatile, at);
    if (!stamp) {
      report.priceUnavailable += 1; // retried next sweep — never guess a price
      continue;
    }

    const decision = decideCpuPick({
      persona: target.persona,
      category: market.category,
      yesPrice: stamp.yesPrice,
      timeToLockMs: target.lockAt.getTime() - at.getTime(),
    });
    if (decision.action === 'wait') {
      report.waited += 1;
      continue;
    }
    if (decision.action === 'skip') {
      report.skipped += 1;
      continue;
    }

    const result = await placePickTx(db, {
      id: uuidv7(),
      questionId: target.questionId,
      profileId: target.cpuProfileId,
      side: decision.side,
      yesPriceAtEntry: stamp.yesPrice,
      priceStampedAt: stamp.ts,
      pickedAt: at,
      source: 'cpu',
    });
    if (result.outcome === 'inserted') report.picked += 1;
    else report.raced += 1; // question_locked (lost the race) or already_picked (dup tick)
  }

  return report;
}

export const cpuPickHandler: JobHandler = async (ctx) => {
  if (!isFlagEnabled('cpu_nemesis')) {
    logger.debug('cpu:pick skipped — cpu_nemesis flag disabled');
    return;
  }
  const report = await runCpuPickSweep(ctx.db, ctx.redis);
  if (report.targets > 0) logger.info({ report }, 'cpu:pick sweep complete');
};
