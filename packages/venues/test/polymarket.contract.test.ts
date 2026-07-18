/**
 * WS1-T3 AC: PolymarketAdapter passes the shared VenueAdapter contract suite against
 * recorded fixtures (`fixtures/polymarket/*.json`) — no live network access.
 */
import { afterEach, beforeEach, describe } from 'vitest';
import { setTestClock } from '@receipts/core';
import { runVenueAdapterContractSuite, type AdapterContractContext } from '../src/contract-suite.js';
import { createVenueHttpClient } from '../src/http-client.js';
import { PolymarketAdapter } from '../src/polymarket/adapter.js';
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

function standardContext(): AdapterContractContext {
  return {
    adapter: buildAdapter(),
    knownMarketId: 'PM-KNOWN-1',
    resolvedYesMarketId: 'PM-RESOLVED-YES-1',
    voidedMarketId: 'PM-VOIDED-1',
    unknownMarketId: 'PM-NO-SUCH-MARKET',
    candidateQuery: { closesWithinH: [0, 48], minLiquidityUsd: 100, limit: 10 },
  };
}

describe('PolymarketAdapter contract', () => {
  beforeEach(() => setTestClock(NOW));
  afterEach(() => setTestClock(null));

  runVenueAdapterContractSuite({ name: 'PolymarketAdapter', setup: standardContext });
});
