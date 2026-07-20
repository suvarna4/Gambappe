/**
 * WS15-T1: the current Kalshi API generation — dollar-string fields (`yes_bid_dollars:
 * "0.9800"`), no legacy cents fields, no per-market `category`, `liquidity_dollars` zeroed
 * on the public feed (live-verified 2026-07-20; see fixtures/venue-notes.md). These tests
 * pin the dollars-first parse paths and the open-interest activity floor that keep the
 * catalog sync from filtering Kalshi to zero.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestClock } from '@receipts/core';
import { createVenueHttpClient } from '../src/http-client.js';
import { KalshiAdapter } from '../src/kalshi/adapter.js';
import {
  kalshiActivityUsd,
  kalshiLiquidityUsd,
  kalshiResolution,
  kalshiYesPrice,
  normalizeKalshiMarket,
} from '../src/kalshi/normalize.js';
import { kalshiMarketSchema, type KalshiMarket } from '../src/kalshi/schemas.js';
import { createFixtureFetch, loadFixture, type FixtureRoute } from './support/fixture-http.js';

const BASE = 'https://kalshi.test/trade-api/v2';
const NOW = '2026-07-19T12:00:00Z';

const base: KalshiMarket = { ticker: 'X', title: 'x', status: 'open', close_time: NOW };

describe('kalshiYesPrice — dollars generation', () => {
  it('uses the yes bid/ask dollars midpoint over last_price_dollars and legacy cents', () => {
    const market: KalshiMarket = {
      ...base,
      yes_bid_dollars: '0.6000',
      yes_ask_dollars: '0.6400',
      last_price_dollars: '0.9900',
      last_price: 5, // stale legacy field must never win over the dollars generation
    };
    expect(kalshiYesPrice(market)).toBeCloseTo(0.62, 5);
  });

  it('falls back to last_price_dollars when the dollars book is absent', () => {
    expect(kalshiYesPrice({ ...base, last_price_dollars: '0.3700' })).toBeCloseTo(0.37, 5);
  });

  it('clamps dollar prices to [0.01, 0.99]', () => {
    expect(kalshiYesPrice({ ...base, yes_bid_dollars: '0.0000', yes_ask_dollars: '0.0000' })).toBe(0.01);
    expect(kalshiYesPrice({ ...base, last_price_dollars: '1.0000' })).toBe(0.99);
  });

  it('still parses the legacy cents generation when no dollars fields exist', () => {
    expect(kalshiYesPrice({ ...base, yes_bid: 60, yes_ask: 64 })).toBeCloseTo(0.62, 5);
  });
});

describe('kalshiLiquidityUsd / kalshiActivityUsd', () => {
  it('reads liquidity_dollars as USD directly (no cents division)', () => {
    expect(kalshiLiquidityUsd({ ...base, liquidity_dollars: '2500.0000' })).toBe(2500);
    expect(kalshiLiquidityUsd({ ...base, liquidity: 250000 })).toBe(2500); // legacy cents
    expect(kalshiLiquidityUsd(base)).toBeUndefined();
  });

  it('activity floor passes on open-interest notional when the feed zeroes liquidity', () => {
    const market: KalshiMarket = {
      ...base,
      liquidity_dollars: '0.0000',
      open_interest_fp: '1500.00',
      notional_value_dollars: '1.0000',
    };
    expect(kalshiActivityUsd(market)).toBe(1500);
    expect(kalshiActivityUsd({ ...base, liquidity_dollars: '0.0000', open_interest_fp: '0.00' })).toBe(0);
  });

  it('takes the max of order-book liquidity and open-interest notional', () => {
    expect(kalshiActivityUsd({ ...base, liquidity_dollars: '3000.0000', open_interest_fp: '10.00' })).toBe(3000);
  });
});

describe('normalizeKalshiMarket — dollars generation', () => {
  const raw = kalshiMarketSchema.parse(
    (loadFixture('kalshi', 'markets-list-dollars.json') as { markets: unknown[] }).markets[0],
  );

  it('prefers expected_expiration_time over expiration_time for expectedResolveTime', () => {
    const market = normalizeKalshiMarket(raw);
    expect(market.expectedResolveTime).toEqual(new Date('2026-07-20T14:00:00Z'));
  });

  it('stores the honest order-book liquidity (0), never the activity proxy', () => {
    const market = normalizeKalshiMarket(raw);
    expect(market.liquidityUsd).toBe(0);
  });

  it('carries open interest and 24h volume in trimmed raw for curator context', () => {
    const market = normalizeKalshiMarket(raw);
    expect(market.raw).toMatchObject({ open_interest: 1500, volume_24h: 320 });
  });

  it('maps a missing category (current API) to other', () => {
    expect(normalizeKalshiMarket(raw).category).toBe('other');
  });
});

describe('kalshiResolution — dollars-generation settled market', () => {
  it('maps finalized + no on a dollars-shape market', () => {
    const market = kalshiMarketSchema.parse({
      ticker: 'KXMVECOMBO-TEST-1',
      title: 'x',
      market_type: 'binary',
      status: 'finalized',
      result: 'no',
      close_time: NOW,
      last_price_dollars: '0.0100',
    });
    expect(kalshiResolution(market)).toEqual({ state: 'resolved', outcome: 'no' });
  });
});

describe('KalshiAdapter.listCandidateMarkets — dollars generation', () => {
  const seenListUrls: URL[] = [];

  function router(url: URL): FixtureRoute | undefined {
    if (url.pathname === '/trade-api/v2/markets') {
      seenListUrls.push(url);
      return { status: 200, body: loadFixture('kalshi', 'markets-list-dollars.json') };
    }
    return undefined;
  }

  function buildAdapter(): KalshiAdapter {
    return new KalshiAdapter({
      baseUrl: BASE,
      http: createVenueHttpClient({
        fetchImpl: createFixtureFetch(router),
        rps: 1000,
        timeoutMs: 2_000,
        maxRetries: 0,
      }),
    });
  }

  beforeEach(() => {
    setTestClock(NOW);
    seenListUrls.length = 0;
  });
  afterEach(() => setTestClock(null));

  it('lists the active market, floors out the zero-interest combo, windows out the far market', async () => {
    const markets = await buildAdapter().listCandidateMarkets({
      closesWithinH: [0, 336],
      minLiquidityUsd: 1000,
      limit: 10,
    });
    expect(markets.map((m) => m.venueMarketId)).toEqual(['KXHIGHTEST-26JUL20-B84']);
    expect(markets[0]!.yesPrice).toBeCloseTo(0.62, 5);
  });

  it('walks the close window in ascending 24h buckets via min/max_close_ts', async () => {
    await buildAdapter().listCandidateMarkets({ closesWithinH: [0, 336], minLiquidityUsd: 1000, limit: 10 });
    expect(seenListUrls.length).toBe(336 / 24); // one page per 24h bucket (fixture has no cursor)
    const nowS = Math.floor(new Date(NOW).getTime() / 1000);
    const first = seenListUrls[0]!;
    expect(first.searchParams.get('status')).toBe('open');
    expect(Number(first.searchParams.get('min_close_ts'))).toBe(nowS);
    expect(Number(first.searchParams.get('max_close_ts'))).toBe(nowS + 24 * 3600);
    const last = seenListUrls.at(-1)!;
    expect(Number(last.searchParams.get('min_close_ts'))).toBe(nowS + 312 * 3600);
    expect(Number(last.searchParams.get('max_close_ts'))).toBe(nowS + 336 * 3600);
  });

  it('collects a market exactly once even though every bucket returns the same page', async () => {
    const markets = await buildAdapter().listCandidateMarkets({
      closesWithinH: [0, 336],
      minLiquidityUsd: 0,
      limit: 100,
    });
    const ids = markets.map((m) => m.venueMarketId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
