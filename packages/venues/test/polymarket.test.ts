/**
 * WS1-T3 AC: multi-outcome exclusion test (Polymarket's `outcomes` array shape), cents-free
 * price fallback tests (Gamma prices are already probabilities, unlike Kalshi cents), CLOB
 * midpoint primary source, ambiguous/disputed resolution → `unresolved` test (§7.4, DD-7).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestClock } from '@receipts/core';
import { createVenueHttpClient } from '../src/http-client.js';
import { mapPolymarketCategory } from '../src/polymarket/category-map.js';
import { PolymarketAdapter } from '../src/polymarket/adapter.js';
import {
  isBinaryPolymarketMarket,
  polymarketGammaYesPrice,
  polymarketResolution,
} from '../src/polymarket/normalize.js';
import type { PolymarketGammaMarket } from '../src/polymarket/schemas.js';
import { createFixtureFetch, loadFixture, type FixtureRoute } from './support/fixture-http.js';

const GAMMA_BASE = 'https://gamma.test/api';
const CLOB_BASE = 'https://clob.test/api';
const NOW = '2026-07-19T12:00:00Z';

const MARKET_FIXTURES: Record<string, string> = {
  'PM-KNOWN-1': 'market-known.json',
  'PM-RESOLVED-YES-1': 'market-resolved-yes.json',
  'PM-VOIDED-1': 'market-voided.json',
  'PM-MULTI-1': 'market-multi-outcome.json',
  'PM-DISPUTED-1': 'market-disputed.json',
};

function router(url: URL): FixtureRoute | undefined {
  if (url.hostname === 'gamma.test') {
    if (url.pathname === '/api/markets') {
      return { status: 200, body: loadFixture('polymarket', 'markets-list.json') };
    }
    const match = /^\/api\/markets\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = match[1]!;
      const file = MARKET_FIXTURES[id];
      if (!file) return { status: 404, body: { error: 'not found' } };
      return { status: 200, body: loadFixture('polymarket', file) };
    }
  }
  if (url.hostname === 'clob.test' && url.pathname === '/api/midpoint') {
    return { status: 200, body: loadFixture('polymarket', 'clob-midpoint-known.json') };
  }
  return undefined;
}

function buildAdapter(): PolymarketAdapter {
  return new PolymarketAdapter({
    gammaBaseUrl: GAMMA_BASE,
    clobBaseUrl: CLOB_BASE,
    http: createVenueHttpClient({
      fetchImpl: createFixtureFetch(router),
      rps: 1000,
      timeoutMs: 2_000,
      maxRetries: 0,
    }),
  });
}

describe('PolymarketAdapter — multi-outcome exclusion (DD-7)', () => {
  beforeEach(() => setTestClock(NOW));
  afterEach(() => setTestClock(null));

  it('excludes markets whose outcomes array is not exactly [Yes, No] from listCandidateMarkets', async () => {
    const adapter = buildAdapter();
    const markets = await adapter.listCandidateMarkets({
      closesWithinH: [0, 48],
      minLiquidityUsd: 0,
      limit: 10,
    });
    expect(markets.map((m) => m.venueMarketId)).not.toContain('PM-MULTI-1');
  });

  it('returns null from getMarket for a 3-outcome market', async () => {
    const adapter = buildAdapter();
    expect(await adapter.getMarket('PM-MULTI-1')).toBeNull();
  });

  it('isBinaryPolymarketMarket requires exactly outcomes=[Yes,No]', () => {
    const base: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
    };
    expect(isBinaryPolymarketMarket(base)).toBe(false); // no outcomes at all — never guess
    expect(isBinaryPolymarketMarket({ ...base, outcomes: ['Yes', 'No'] })).toBe(true);
    expect(isBinaryPolymarketMarket({ ...base, outcomes: ['No', 'Yes'] })).toBe(true);
    expect(
      isBinaryPolymarketMarket({ ...base, outcomes: ['Candidate A', 'Candidate B', 'Candidate C'] }),
    ).toBe(false);
    expect(isBinaryPolymarketMarket({ ...base, outcomes: ['Yes', 'Maybe'] })).toBe(false);
  });
});

describe('PolymarketAdapter — price sourcing', () => {
  it('polymarketGammaYesPrice reads the Yes-labeled outcomePrices slot, clamped', () => {
    const market: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
      outcomes: ['Yes', 'No'],
      outcomePrices: ['0.73', '0.27'],
    };
    expect(polymarketGammaYesPrice(market)).toBeCloseTo(0.73, 5);
  });

  it('clamps extreme outcomePrices to [0.01, 0.99]', () => {
    const zero: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
      outcomes: ['Yes', 'No'],
      outcomePrices: ['0', '1'],
    };
    expect(polymarketGammaYesPrice(zero)).toBe(0.01);
  });

  it('getYesPrice prefers the CLOB midpoint over the Gamma outcomePrices fallback', async () => {
    setTestClock(NOW);
    const adapter = buildAdapter();
    const quote = await adapter.getYesPrice('PM-KNOWN-1');
    expect(quote).not.toBeNull();
    // clob-midpoint-known.json says 0.63; Gamma outcomePrices says 0.62 — CLOB wins.
    expect(quote!.yesPrice).toBeCloseTo(0.63, 5);
    setTestClock(null);
  });

  it('falls back to Gamma outcomePrices when the CLOB call fails', async () => {
    setTestClock(NOW);
    const failingClobRouter = (url: URL): FixtureRoute | undefined => {
      if (url.hostname === 'clob.test') return { status: 500, body: { error: 'down' } };
      return router(url);
    };
    const adapter = new PolymarketAdapter({
      gammaBaseUrl: GAMMA_BASE,
      clobBaseUrl: CLOB_BASE,
      http: createVenueHttpClient({
        fetchImpl: createFixtureFetch(failingClobRouter),
        rps: 1000,
        timeoutMs: 2_000,
        maxRetries: 0,
      }),
    });
    const quote = await adapter.getYesPrice('PM-KNOWN-1');
    expect(quote).not.toBeNull();
    expect(quote!.yesPrice).toBeCloseTo(0.62, 5); // Gamma outcomePrices fallback
    setTestClock(null);
  });
});

describe('PolymarketAdapter — resolution mapping (never guess)', () => {
  it('maps closed + one-sided outcomePrices to resolved', () => {
    const yesMarket: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
      closed: true,
      outcomes: ['Yes', 'No'],
      outcomePrices: ['1', '0'],
      umaResolutionStatus: 'resolved',
    };
    const noMarket: PolymarketGammaMarket = {
      ...yesMarket,
      outcomePrices: ['0', '1'],
    };
    expect(polymarketResolution(yesMarket)).toEqual({ state: 'resolved', outcome: 'yes' });
    expect(polymarketResolution(noMarket)).toEqual({ state: 'resolved', outcome: 'no' });
  });

  it('maps both-near-zero outcomePrices to voided', () => {
    const market: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
      closed: true,
      outcomes: ['Yes', 'No'],
      outcomePrices: ['0', '0'],
      umaResolutionStatus: 'resolved',
    };
    expect(polymarketResolution(market)).toEqual({ state: 'voided' });
  });

  it('treats an open (not closed) market as unresolved', () => {
    const market: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
      closed: false,
      outcomes: ['Yes', 'No'],
      outcomePrices: ['0.6', '0.4'],
    };
    expect(polymarketResolution(market)).toEqual({ state: 'unresolved' });
  });

  it('treats an in-flight UMA dispute as unresolved regardless of prices', async () => {
    setTestClock(NOW);
    const adapter = buildAdapter();
    expect(await adapter.getResolution('PM-DISPUTED-1')).toEqual({ state: 'unresolved' });
    setTestClock(null);
  });

  it('treats an ambiguous 50/50 non-disputed split as unresolved (never guess)', () => {
    const market: PolymarketGammaMarket = {
      id: 'X',
      question: 'x',
      endDate: NOW,
      closed: true,
      outcomes: ['Yes', 'No'],
      outcomePrices: ['0.5', '0.5'],
      umaResolutionStatus: 'resolved',
    };
    expect(polymarketResolution(market)).toEqual({ state: 'unresolved' });
  });
});

describe('mapPolymarketCategory', () => {
  it('maps known Gamma categories', () => {
    expect(mapPolymarketCategory('Politics')).toBe('politics');
    expect(mapPolymarketCategory('Crypto')).toBe('economics');
    expect(mapPolymarketCategory('Sports')).toBe('sports');
  });

  it('defaults unrecognized/missing categories to other', () => {
    expect(mapPolymarketCategory('Something Unmapped')).toBe('other');
    expect(mapPolymarketCategory(undefined)).toBe('other');
    expect(mapPolymarketCategory(null)).toBe('other');
  });
});
