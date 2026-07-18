/**
 * §6.2 step 4 price stamping for the pick endpoint: wires the pure `stampPrice` ladder
 * (`@receipts/core`) to real Redis (cache + single-flight coalescing), Postgres (DB fallback),
 * and a venue adapter (the one narrow §2.2 exception — a synchronous fetch, 2s timeout).
 */
import type { Redis } from 'ioredis';
import { stampPrice, type PriceStampOutcome, type PriceStampSources } from '@receipts/core';
import { getMarketById, type Db, type MarketRow } from '@receipts/db';
import type { VenueAdapter } from '@receipts/venues';
import { singleFlight, type SingleFlightRedis } from './single-flight';

/** §6.2 step 4: "2s timeout" on the single-flight sync fetch. */
const SYNC_FETCH_TIMEOUT_MS = 2_000;

function priceCacheKey(venue: string, venueMarketId: string): string {
  return `price:${venue}:${venueMarketId}`;
}

function redisAsSingleFlight(redis: Redis): SingleFlightRedis {
  return {
    setNx: (key, value, ttlMs) => redis.set(key, value, 'PX', ttlMs, 'NX'),
    get: (key) => redis.get(key),
    setResult: async (key, value, ttlMs) => {
      await redis.set(key, value, 'PX', ttlMs);
    },
    del: async (key) => {
      await redis.del(key);
    },
  };
}

async function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('venue fetch timeout')), ms)),
  ]);
}

export interface ResolvePriceStampArgs {
  db: Db;
  redis: Redis;
  adapters: VenueAdapter[];
  marketId: string;
  isVolatile: boolean;
  at: Date;
}

/** Resolves the §6.2 step 4 ladder for a pick. `null` → caller raises `PRICE_UNAVAILABLE` (503). */
export async function resolvePickPriceStamp(args: ResolvePriceStampArgs): Promise<PriceStampOutcome | null> {
  const market = await getMarketById(args.db, args.marketId);
  if (!market) return null;
  return resolvePriceStampForMarket({ ...args, market });
}

export async function resolvePriceStampForMarket(
  args: Omit<ResolvePriceStampArgs, 'marketId' | 'db'> & { market: MarketRow },
): Promise<PriceStampOutcome | null> {
  const { redis, adapters, market, isVolatile, at } = args;
  const adapter = adapters.find((a) => a.venue === market.venue);

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
    syncFetch: async () => {
      if (!adapter) return null;
      const singleFlightKey = `${market.venue}:${market.venueMarketId}`;
      // singleFlight's payload is JSON-round-tripped through Redis for followers, so `ts`
      // travels as an ISO string here and is re-hydrated to a `Date` after the call.
      const quote = await singleFlight<{ yesPrice: number; ts: string }>(
        redisAsSingleFlight(redis),
        singleFlightKey,
        async () => {
          const q = await timeout(adapter.getYesPrice(market.venueMarketId), SYNC_FETCH_TIMEOUT_MS);
          if (!q) throw new Error('venue adapter returned no quote');
          return { yesPrice: q.yesPrice, ts: q.ts.toISOString() };
        },
        { timeoutMs: SYNC_FETCH_TIMEOUT_MS },
      );
      if (!quote) return null;

      // Publish to the shared price cache too — the winner of the single-flight fetch benefits
      // future pickers/the lock job just like a `venue:price-tick` write would (§6.2/§7.5).
      await redis
        .set(priceCacheKey(market.venue, market.venueMarketId), JSON.stringify(quote), 'EX', 300)
        .catch(() => {});
      return { yesPrice: quote.yesPrice, ts: new Date(quote.ts) };
    },
  };

  return stampPrice(sources, isVolatile, at);
}
