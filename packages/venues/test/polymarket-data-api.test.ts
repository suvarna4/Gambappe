/**
 * WS12-T2: `PolymarketDataApiClient` HTTP-layer behavior — 404/empty address degrades to `[]`,
 * `getActivity` never throws (best-effort only, §12.4), malformed bodies from other statuses
 * still surface as errors from `getPositions` (never a silent wrong "success").
 */
import { describe, expect, it } from 'vitest';
import { createVenueHttpClient } from '../src/http-client.js';
import { PolymarketDataApiClient } from '../src/polymarket/data-api.js';
import { createFixtureFetch, type FixtureRoute } from './support/fixture-http.js';

const DATA_BASE = 'https://data-api.test';

const SEEN_ADDRESS = '0x1111111111111111111111111111111111111a';
const UNSEEN_ADDRESS = '0x2222222222222222222222222222222222222b';
const ERRORING_ADDRESS = '0x3333333333333333333333333333333333333c';

function router(url: URL): FixtureRoute | undefined {
  if (url.hostname !== 'data-api.test') return undefined;
  const user = url.searchParams.get('user');
  if (url.pathname === '/positions') {
    if (user === SEEN_ADDRESS) {
      return {
        status: 200,
        body: [
          { conditionId: 'c1', title: 'Will X happen?', category: 'Politics', outcome: 'Yes', size: 100, avgPrice: 0.6, initialValue: 60 },
        ],
      };
    }
    if (user === UNSEEN_ADDRESS) return { status: 404, body: { error: 'not found' } };
    if (user === ERRORING_ADDRESS) return { status: 500, body: { error: 'boom' } };
    return { status: 200, body: [] };
  }
  if (url.pathname === '/activity') {
    if (user === ERRORING_ADDRESS) return { status: 500, body: { error: 'boom' } };
    return { status: 200, body: [{ type: 'TRADE', timestamp: 1_700_000_000, usdcSize: 60, price: 0.6 }] };
  }
  return undefined;
}

function buildClient(): PolymarketDataApiClient {
  return new PolymarketDataApiClient({
    dataBaseUrl: DATA_BASE,
    http: createVenueHttpClient({
      fetchImpl: createFixtureFetch(router),
      rps: 1000,
      timeoutMs: 2_000,
      maxRetries: 0,
    }),
  });
}

describe('PolymarketDataApiClient.getPositions', () => {
  it('parses a known positions response', async () => {
    const client = buildClient();
    const positions = await client.getPositions(SEEN_ADDRESS);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.avgPrice).toBe(0.6);
  });

  it('an address the API has never seen (404) resolves to an empty array, not an error', async () => {
    const client = buildClient();
    await expect(client.getPositions(UNSEEN_ADDRESS)).resolves.toEqual([]);
  });

  it('a real upstream failure (5xx) still throws — never a silent empty "success"', async () => {
    const client = buildClient();
    await expect(client.getPositions(ERRORING_ADDRESS)).rejects.toThrow();
  });
});

describe('PolymarketDataApiClient.getActivity', () => {
  it('parses a known activity response', async () => {
    const client = buildClient();
    const activity = await client.getActivity(SEEN_ADDRESS);
    expect(activity).toHaveLength(1);
    expect(activity[0]?.timestamp).toBe(1_700_000_000);
  });

  it('never throws — any failure degrades to [] (best-effort timing source only, §12.4)', async () => {
    const client = buildClient();
    await expect(client.getActivity(ERRORING_ADDRESS)).resolves.toEqual([]);
  });
});
