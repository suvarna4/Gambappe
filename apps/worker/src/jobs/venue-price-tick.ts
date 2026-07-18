/**
 * `venue:price-tick` (WS1-T4; §7.5 every 60s): for markets referenced by `open`/`locked`
 * questions, fetch the current price and write Redis `price:{venue}:{venueMarketId}` (TTL
 * `PRICE_FALLBACK_STALENESS_S`) + `markets.yes_price`/`yes_price_updated_at` + a
 * `market_price_snapshots` row on the §7.5 cadence: every tick while `open`; every 5 min
 * while `locked`-only (tracked via the market's last snapshot timestamp, so this is correct
 * regardless of the job's actual firing cadence — no reliance on "runs exactly every 60s").
 *
 * Tracks per-venue consecutive-failure streaks in Redis (survives worker restarts, unlike an
 * in-process counter): after 3 straight ticks with zero successful fetches for a venue, sets
 * `venue_degraded:{venue}`; the next tick with at least one success clears it (§7.5).
 */
import type { Redis } from 'ioredis';
import { now, PRICE_FALLBACK_STALENESS_S } from '@receipts/core';
import type { VenueAdapter } from '@receipts/venues';
import {
  getLastSnapshotTs,
  insertPriceSnapshot,
  listMarketsForPriceTick,
  updateMarketPrice,
  type Db,
  type PriceTickMarket,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { defaultVenueAdapters } from '../venues.js';

/** §7.5: "every 5 min while locked." */
const SNAPSHOT_LOCKED_INTERVAL_MS = 5 * 60_000;
/** §7.5: "venue_degraded ... set after 3 consecutive tick failures." */
const FAIL_STREAK_THRESHOLD = 3;

function priceCacheKey(venue: string, venueMarketId: string): string {
  return `price:${venue}:${venueMarketId}`;
}
function degradedKey(venue: string): string {
  return `venue_degraded:${venue}`;
}
function failStreakKey(venue: string): string {
  return `venue_fail_streak:${venue}`;
}

interface TickOutcome {
  ok: boolean;
  snapshotted: boolean;
}

async function tickOneMarket(
  db: Db,
  redis: Redis,
  adapter: VenueAdapter,
  market: PriceTickMarket,
  at: Date,
): Promise<TickOutcome> {
  const quote = await adapter.getYesPrice(market.venueMarketId);
  if (!quote) return { ok: false, snapshotted: false };

  await redis.set(
    priceCacheKey(market.venue, market.venueMarketId),
    JSON.stringify({ yesPrice: quote.yesPrice, ts: quote.ts.toISOString() }),
    'EX',
    PRICE_FALLBACK_STALENESS_S,
  );
  await updateMarketPrice(db, market.marketId, quote.yesPrice, quote.ts);

  let snapshotted = false;
  if (market.hasOpenQuestion) {
    await insertPriceSnapshot(db, market.marketId, at, quote.yesPrice);
    snapshotted = true;
  } else if (market.hasLockedQuestion) {
    const lastTs = await getLastSnapshotTs(db, market.marketId);
    if (!lastTs || at.getTime() - lastTs.getTime() >= SNAPSHOT_LOCKED_INTERVAL_MS) {
      await insertPriceSnapshot(db, market.marketId, at, quote.yesPrice);
      snapshotted = true;
    }
  }
  return { ok: true, snapshotted };
}

export interface PriceTickReport {
  checked: number;
  updated: number;
  snapshotted: number;
  failed: number;
  degradedVenues: string[];
  clearedVenues: string[];
}

export async function runVenuePriceTick(
  db: Db,
  redis: Redis,
  adapters: VenueAdapter[] = defaultVenueAdapters(),
  at: Date = now(),
): Promise<PriceTickReport> {
  const markets = await listMarketsForPriceTick(db);
  const adapterByVenue = new Map(adapters.map((a) => [a.venue, a]));
  const perVenue = new Map<string, { attempted: number; succeeded: number }>();

  const report: PriceTickReport = {
    checked: markets.length,
    updated: 0,
    snapshotted: 0,
    failed: 0,
    degradedVenues: [],
    clearedVenues: [],
  };

  for (const market of markets) {
    const stat = perVenue.get(market.venue) ?? { attempted: 0, succeeded: 0 };
    stat.attempted++;
    perVenue.set(market.venue, stat);

    const adapter = adapterByVenue.get(market.venue as VenueAdapter['venue']);
    if (!adapter) {
      report.failed++;
      continue;
    }
    try {
      const outcome = await tickOneMarket(db, redis, adapter, market, at);
      if (outcome.ok) {
        report.updated++;
        stat.succeeded++;
        if (outcome.snapshotted) report.snapshotted++;
      } else {
        report.failed++;
      }
    } catch (err) {
      logger.warn(
        { err, venue: market.venue, venueMarketId: market.venueMarketId },
        'venue:price-tick fetch failed',
      );
      report.failed++;
    }
  }

  for (const [venue, stat] of perVenue) {
    if (stat.succeeded > 0) {
      await redis.del(failStreakKey(venue));
      const cleared = await redis.del(degradedKey(venue));
      if (cleared > 0) {
        report.clearedVenues.push(venue);
        logger.info({ venue }, 'venue_degraded cleared');
      }
    } else {
      const streak = await redis.incr(failStreakKey(venue));
      if (streak >= FAIL_STREAK_THRESHOLD) {
        await redis.set(degradedKey(venue), '1');
        report.degradedVenues.push(venue);
        logger.warn({ venue, streak }, 'venue_degraded set');
      }
    }
  }

  return report;
}

export const venuePriceTickHandler: JobHandler = async (ctx) => {
  const report = await runVenuePriceTick(ctx.db, ctx.redis);
  logger.info({ report }, 'venue:price-tick complete');
};
