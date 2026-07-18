/**
 * §6.2 step 4 price-stamping ladder — shared orchestration for the pick endpoint (WS3-T2) and
 * the lock-snapshot price (WS3-T1, "same staleness rules"). Pure orchestration over injected
 * async sources so it is unit-testable without Redis/Postgres/a venue adapter: callers supply
 * `readCache`/`readDbFallback`/`syncFetch` and this function decides which rung's reading (if
 * any) is fresh enough, in the exact order the design doc specifies.
 *
 * `syncFetch` is optional — the lock job never attempts a live venue fetch (§6.2 lock job only
 * reads "cache/DB, same staleness rules"); the pick endpoint always supplies it (the one narrow
 * §2.2 exception to "web never calls venue APIs synchronously").
 */
import {
  PRICE_FALLBACK_STALENESS_S,
  PRICE_MAX_STALENESS_S,
  VOLATILE_PRICE_MAX_STALENESS_S,
} from './config.js';

export interface PriceStampReading {
  yesPrice: number;
  ts: Date;
}

export interface PriceStampSources {
  readCache: () => Promise<PriceStampReading | null>;
  readDbFallback: () => Promise<PriceStampReading | null>;
  /** Single-flight synchronous adapter fetch (§6.2 step 4); absent on the lock-job call site. */
  syncFetch?: () => Promise<PriceStampReading | null>;
}

export type PriceStampSource = 'cache' | 'sync_fetch' | 'db_fallback';

export interface PriceStampOutcome extends PriceStampReading {
  source: PriceStampSource;
}

function ageS(ts: Date, at: Date): number {
  return (at.getTime() - ts.getTime()) / 1000;
}

/** Max age (s) a reading may have to be usable at all (cache or a fresh sync fetch). */
export function cacheStalenessLimitS(isVolatile: boolean): number {
  return isVolatile ? VOLATILE_PRICE_MAX_STALENESS_S : PRICE_MAX_STALENESS_S;
}

/**
 * Resolves a price stamp per §6.2 step 4: cache (≤`cacheStalenessLimitS`) → single-flight sync
 * fetch (same freshness bar — it just ran, so it always qualifies in practice) → DB fallback
 * (`markets.yes_price`, ≤`PRICE_FALLBACK_STALENESS_S`, **non-volatile questions only** — no
 * exception) → `null` (caller raises `PRICE_UNAVAILABLE`, 503).
 */
export async function stampPrice(
  sources: PriceStampSources,
  isVolatile: boolean,
  at: Date,
): Promise<PriceStampOutcome | null> {
  const cacheLimit = cacheStalenessLimitS(isVolatile);

  const cached = await sources.readCache();
  if (cached && ageS(cached.ts, at) <= cacheLimit) {
    return { ...cached, source: 'cache' };
  }

  if (sources.syncFetch) {
    const fetched = await sources.syncFetch().catch(() => null);
    if (fetched && ageS(fetched.ts, at) <= cacheLimit) {
      return { ...fetched, source: 'sync_fetch' };
    }
  }

  if (!isVolatile) {
    const fallback = await sources.readDbFallback();
    if (fallback && ageS(fallback.ts, at) <= PRICE_FALLBACK_STALENESS_S) {
      return { ...fallback, source: 'db_fallback' };
    }
  }

  return null;
}
