/**
 * WS1-T2 AC: KalshiAdapter passes the shared VenueAdapter contract suite against recorded
 * fixtures (`fixtures/kalshi/*.json`) — no live network access.
 */
import { afterEach, beforeEach, describe } from 'vitest';
import { setTestClock } from '@receipts/core';
import { runVenueAdapterContractSuite, type AdapterContractContext } from '../src/contract-suite.js';
import { KalshiAdapter } from '../src/kalshi/adapter.js';
import { createVenueHttpClient } from '../src/http-client.js';
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

function standardContext(): AdapterContractContext {
  return {
    adapter: buildAdapter(),
    knownMarketId: 'KX-KNOWN-1',
    resolvedYesMarketId: 'KX-RESOLVED-YES-1',
    voidedMarketId: 'KX-VOIDED-1',
    unknownMarketId: 'KX-NO-SUCH-MARKET',
    candidateQuery: { closesWithinH: [0, 48], minLiquidityUsd: 100, limit: 10 },
  };
}

describe('KalshiAdapter contract', () => {
  beforeEach(() => setTestClock(NOW));
  afterEach(() => setTestClock(null));

  runVenueAdapterContractSuite({ name: 'KalshiAdapter', setup: standardContext });
});
