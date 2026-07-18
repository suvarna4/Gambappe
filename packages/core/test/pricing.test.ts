/**
 * §6.2 step 4 price-stamping ladder (WS3-T2 AC: "stamp staleness ladder tested — mock each
 * rung: fresh cache, stale-cache-but-fresh-DB, both-stale-triggers-sync-fetch, all-exhausted-
 * 503"). Pure orchestration over injected sources — no Redis/Postgres/venue adapter needed.
 */
import { describe, expect, it, vi } from 'vitest';
import { PRICE_FALLBACK_STALENESS_S, PRICE_MAX_STALENESS_S } from '../src/config.js';
import { stampPrice, type PriceStampSources } from '../src/pricing.js';

const AT = new Date('2026-07-19T15:00:00Z');

function secondsAgo(s: number): Date {
  return new Date(AT.getTime() - s * 1000);
}

describe('stampPrice (§6.2 step 4 ladder)', () => {
  it('fresh cache (≤60s): used directly, no fetch/DB read attempted', async () => {
    const syncFetch = vi.fn();
    const readDbFallback = vi.fn();
    const sources: PriceStampSources = {
      readCache: async () => ({ yesPrice: 0.42, ts: secondsAgo(10) }),
      readDbFallback,
      syncFetch,
    };
    const result = await stampPrice(sources, false, AT);
    expect(result).toEqual({ yesPrice: 0.42, ts: secondsAgo(10), source: 'cache' });
    expect(syncFetch).not.toHaveBeenCalled();
    expect(readDbFallback).not.toHaveBeenCalled();
  });

  it('stale cache, no syncFetch supplied (lock job): falls back to fresh DB reading', async () => {
    const sources: PriceStampSources = {
      readCache: async () => ({ yesPrice: 0.5, ts: secondsAgo(PRICE_MAX_STALENESS_S + 1) }),
      readDbFallback: async () => ({ yesPrice: 0.55, ts: secondsAgo(60) }),
      // no syncFetch — the lock job never attempts a live venue call
    };
    const result = await stampPrice(sources, false, AT);
    expect(result).toEqual({ yesPrice: 0.55, ts: secondsAgo(60), source: 'db_fallback' });
  });

  it('stale cache + failed sync fetch, fresh DB fallback (non-volatile): uses DB', async () => {
    const sources: PriceStampSources = {
      readCache: async () => null,
      readDbFallback: async () => ({ yesPrice: 0.6, ts: secondsAgo(120) }),
      syncFetch: async () => null, // adapter fetch failed/timed out
    };
    const result = await stampPrice(sources, false, AT);
    expect(result).toEqual({ yesPrice: 0.6, ts: secondsAgo(120), source: 'db_fallback' });
  });

  it('stale cache, successful sync fetch: uses the fresh fetched price over DB', async () => {
    const readDbFallback = vi.fn();
    const sources: PriceStampSources = {
      readCache: async () => null,
      readDbFallback,
      syncFetch: async () => ({ yesPrice: 0.71, ts: AT }),
    };
    const result = await stampPrice(sources, false, AT);
    expect(result).toEqual({ yesPrice: 0.71, ts: AT, source: 'sync_fetch' });
    expect(readDbFallback).not.toHaveBeenCalled();
  });

  it('all rungs exhausted: returns null (caller raises PRICE_UNAVAILABLE)', async () => {
    const sources: PriceStampSources = {
      readCache: async () => null,
      readDbFallback: async () => ({ yesPrice: 0.6, ts: secondsAgo(PRICE_FALLBACK_STALENESS_S + 1) }),
      syncFetch: async () => null,
    };
    const result = await stampPrice(sources, false, AT);
    expect(result).toBeNull();
  });

  it('a sync fetch that throws is treated as a failure, not an unhandled rejection', async () => {
    const sources: PriceStampSources = {
      readCache: async () => null,
      readDbFallback: async () => ({ yesPrice: 0.6, ts: secondsAgo(30) }),
      syncFetch: async () => {
        throw new Error('adapter timeout');
      },
    };
    const result = await stampPrice(sources, false, AT);
    expect(result?.source).toBe('db_fallback');
  });

  it('is_volatile questions never use DB fallback, even when fresh', async () => {
    const readDbFallback = vi.fn(async () => ({ yesPrice: 0.6, ts: secondsAgo(30) }));
    const sources: PriceStampSources = {
      readCache: async () => null,
      readDbFallback,
      syncFetch: async () => null,
    };
    const result = await stampPrice(sources, true, AT);
    expect(result).toBeNull();
    expect(readDbFallback).not.toHaveBeenCalled();
  });

  it('is_volatile questions accept only a ≤60s sync fetch', async () => {
    const sources: PriceStampSources = {
      readCache: async () => null,
      readDbFallback: async () => null,
      syncFetch: async () => ({ yesPrice: 0.6, ts: AT }),
    };
    const result = await stampPrice(sources, true, AT);
    expect(result).toEqual({ yesPrice: 0.6, ts: AT, source: 'sync_fetch' });
  });
});
