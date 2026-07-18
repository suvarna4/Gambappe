/**
 * WS1-T2 AC: binary-only filter test, cents→[0,1] conversion tests, ambiguous resolution →
 * `unresolved` test (§7.3, DD-7). Runs against recorded fixtures — no live network access.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestClock } from '@receipts/core';
import { createVenueHttpClient } from '../src/http-client.js';
import { KalshiAdapter } from '../src/kalshi/adapter.js';
import { mapKalshiCategory } from '../src/kalshi/category-map.js';
import { isBinaryKalshiMarket, kalshiResolution, kalshiYesPrice } from '../src/kalshi/normalize.js';
import type { KalshiMarket } from '../src/kalshi/schemas.js';
import { createFixtureFetch, loadFixture, type FixtureRoute } from './support/fixture-http.js';

const BASE = 'https://kalshi.test/trade-api/v2';
const NOW = '2026-07-19T12:00:00Z';

const MARKET_FIXTURES: Record<string, string> = {
  'KX-KNOWN-1': 'market-known.json',
  'KX-RESOLVED-YES-1': 'market-resolved-yes.json',
  'KX-VOIDED-1': 'market-voided.json',
  'KX-MULTI-1': 'market-multi-outcome.json',
  'KX-AMBIGUOUS-1': 'market-ambiguous.json',
};

function router(url: URL): FixtureRoute | undefined {
  if (url.pathname === '/trade-api/v2/markets') {
    return { status: 200, body: loadFixture('kalshi', 'markets-list.json') };
  }
  const match = /^\/trade-api\/v2\/markets\/([^/]+)$/.exec(url.pathname);
  if (match) {
    const ticker = match[1]!;
    const file = MARKET_FIXTURES[ticker];
    if (!file) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: loadFixture('kalshi', file) };
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

describe('KalshiAdapter — binary-only filter (DD-7)', () => {
  beforeEach(() => setTestClock(NOW));
  afterEach(() => setTestClock(null));

  it('excludes multi-outcome markets from listCandidateMarkets', async () => {
    const adapter = buildAdapter();
    const markets = await adapter.listCandidateMarkets({
      closesWithinH: [0, 48],
      minLiquidityUsd: 0,
      limit: 10,
    });
    expect(markets.map((m) => m.venueMarketId)).not.toContain('KX-MULTI-1');
  });

  it('returns null from getMarket for a multi-outcome ticker', async () => {
    const adapter = buildAdapter();
    expect(await adapter.getMarket('KX-MULTI-1')).toBeNull();
  });

  it('isBinaryKalshiMarket rejects non-binary market_type', () => {
    const base: KalshiMarket = {
      ticker: 'X',
      title: 'x',
      status: 'open',
      close_time: NOW,
    };
    expect(isBinaryKalshiMarket(base)).toBe(true); // undefined market_type defaults binary
    expect(isBinaryKalshiMarket({ ...base, market_type: 'binary' })).toBe(true);
    expect(isBinaryKalshiMarket({ ...base, market_type: 'multiple_choice' })).toBe(false);
  });
});

describe('KalshiAdapter — cents→[0,1] price conversion', () => {
  it('uses the yes bid/ask midpoint when both present', () => {
    const market: KalshiMarket = {
      ticker: 'X',
      title: 'x',
      status: 'open',
      close_time: NOW,
      yes_bid: 60,
      yes_ask: 64,
      last_price: 999, // must be ignored when bid/ask present
    };
    expect(kalshiYesPrice(market)).toBeCloseTo(0.62, 5);
  });

  it('falls back to last_price when bid/ask are missing', () => {
    const market: KalshiMarket = {
      ticker: 'X',
      title: 'x',
      status: 'open',
      close_time: NOW,
      last_price: 37,
    };
    expect(kalshiYesPrice(market)).toBeCloseTo(0.37, 5);
  });

  it('clamps to [0.01, 0.99] at the extremes', () => {
    const zero: KalshiMarket = { ticker: 'X', title: 'x', status: 'open', close_time: NOW, last_price: 0 };
    const hundred: KalshiMarket = { ticker: 'X', title: 'x', status: 'open', close_time: NOW, last_price: 100 };
    expect(kalshiYesPrice(zero)).toBe(0.01);
    expect(kalshiYesPrice(hundred)).toBe(0.99);
  });

  it('returns undefined when no price data is present', () => {
    const market: KalshiMarket = { ticker: 'X', title: 'x', status: 'open', close_time: NOW };
    expect(kalshiYesPrice(market)).toBeUndefined();
  });

  it('getYesPrice returns the converted, clamped probability via the adapter', async () => {
    setTestClock(NOW);
    const adapter = buildAdapter();
    const quote = await adapter.getYesPrice('KX-KNOWN-1');
    expect(quote).not.toBeNull();
    expect(quote!.yesPrice).toBeCloseTo(0.62, 5); // (60+64)/2/100
    setTestClock(null);
  });
});

describe('KalshiAdapter — resolution mapping (never guess)', () => {
  it('maps settled/finalized + yes|no result to resolved', () => {
    const yesMarket: KalshiMarket = {
      ticker: 'X',
      title: 'x',
      status: 'finalized',
      close_time: NOW,
      result: 'yes',
    };
    const noMarket: KalshiMarket = { ...yesMarket, result: 'no' };
    expect(kalshiResolution(yesMarket)).toEqual({ state: 'resolved', outcome: 'yes' });
    expect(kalshiResolution(noMarket)).toEqual({ state: 'resolved', outcome: 'no' });
  });

  it('maps a void result to voided', () => {
    const market: KalshiMarket = {
      ticker: 'X',
      title: 'x',
      status: 'finalized',
      close_time: NOW,
      result: 'void',
    };
    expect(kalshiResolution(market)).toEqual({ state: 'voided' });
  });

  it('treats an open market as unresolved', () => {
    const market: KalshiMarket = { ticker: 'X', title: 'x', status: 'open', close_time: NOW };
    expect(kalshiResolution(market)).toEqual({ state: 'unresolved' });
  });

  it('treats an unrecognized result token on a settled market as unresolved (never guess)', () => {
    const market: KalshiMarket = {
      ticker: 'X',
      title: 'x',
      status: 'finalized',
      close_time: NOW,
      result: 'draw',
    };
    expect(kalshiResolution(market)).toEqual({ state: 'unresolved' });
  });

  it('ambiguous fixture (unrecognized result token) resolves to unresolved via the adapter', async () => {
    setTestClock(NOW);
    const adapter = buildAdapter();
    expect(await adapter.getResolution('KX-AMBIGUOUS-1')).toEqual({ state: 'unresolved' });
    setTestClock(null);
  });
});

describe('mapKalshiCategory', () => {
  it('maps known Kalshi categories', () => {
    expect(mapKalshiCategory('Politics')).toBe('politics');
    expect(mapKalshiCategory('Sports')).toBe('sports');
    expect(mapKalshiCategory('Economics')).toBe('economics');
    expect(mapKalshiCategory('Climate and Weather')).toBe('science');
    expect(mapKalshiCategory('Entertainment')).toBe('culture');
  });

  it('defaults unrecognized/missing categories to other', () => {
    expect(mapKalshiCategory('Something Unmapped')).toBe('other');
    expect(mapKalshiCategory(undefined)).toBe('other');
    expect(mapKalshiCategory(null)).toBe('other');
  });
});
