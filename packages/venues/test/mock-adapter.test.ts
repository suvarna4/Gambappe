/**
 * WS0-T6 AC: the MockVenueAdapter passes the shared contract suite; plus scriptability
 * tests (scheduled prices/resolutions via TEST_CLOCK, DD-7 binary filter, failure injection).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setTestClock } from '@receipts/core';
import { MockVenueAdapter } from '../src/mock/index.js';
import {
  runVenueAdapterContractSuite,
  type AdapterContractContext,
} from '../src/contract-suite.js';

function standardContext(): AdapterContractContext {
  const adapter = new MockVenueAdapter('kalshi');
  adapter
    .addMarket({ venueMarketId: 'OPEN-1', yesPrice: 0.63, liquidityUsd: 50_000 })
    .addMarket({ venueMarketId: 'RESOLVED-1', yesPrice: 0.8 })
    .addMarket({ venueMarketId: 'VOIDED-1' })
    .resolve('RESOLVED-1', 'yes')
    .void('VOIDED-1');
  return {
    adapter,
    knownMarketId: 'OPEN-1',
    resolvedYesMarketId: 'RESOLVED-1',
    voidedMarketId: 'VOIDED-1',
    unknownMarketId: 'NO-SUCH-MARKET',
    candidateQuery: { closesWithinH: [0, 48], minLiquidityUsd: 100, limit: 10 },
  };
}

runVenueAdapterContractSuite({ name: 'MockVenueAdapter', setup: standardContext });

describe('MockVenueAdapter scripting', () => {
  afterEach(() => setTestClock(null));

  it('filters multi-outcome markets (DD-7)', async () => {
    const adapter = new MockVenueAdapter('polymarket');
    adapter
      .addMarket({ venueMarketId: 'BINARY', outcomes: ['Yes', 'No'], liquidityUsd: 1000 })
      .addMarket({
        venueMarketId: 'MULTI',
        outcomes: ['Candidate A', 'Candidate B', 'Candidate C'],
        liquidityUsd: 1000,
      });
    const listed = await adapter.listCandidateMarkets({
      closesWithinH: [0, 48],
      minLiquidityUsd: 0,
      limit: 10,
    });
    expect(listed.map((m) => m.venueMarketId)).toEqual(['BINARY']);
    expect(await adapter.getMarket('MULTI')).toBeNull();
    expect(await adapter.getYesPrice('MULTI')).toBeNull();
  });

  it('clamps prices to [0.01, 0.99] (§7.1)', async () => {
    const adapter = new MockVenueAdapter();
    adapter.addMarket({ venueMarketId: 'M', yesPrice: 0 });
    expect((await adapter.getYesPrice('M'))!.yesPrice).toBe(0.01);
    adapter.setYesPrice('M', 1.5);
    expect((await adapter.getYesPrice('M'))!.yesPrice).toBe(0.99);
  });

  it('applies scheduled prices when the (test) clock reaches them (§17.2 plumbing)', async () => {
    setTestClock('2026-07-19T15:00:00Z');
    const adapter = new MockVenueAdapter();
    adapter.addMarket({ venueMarketId: 'M', yesPrice: 0.5 });
    adapter.schedulePrice('M', new Date('2026-07-19T15:30:00Z'), 0.72);

    expect((await adapter.getYesPrice('M'))!.yesPrice).toBe(0.5);
    setTestClock('2026-07-19T15:31:00Z');
    const quote = await adapter.getYesPrice('M');
    expect(quote!.yesPrice).toBe(0.72);
    expect(quote!.ts.toISOString()).toBe('2026-07-19T15:30:00.000Z');
  });

  it('applies scheduled resolutions on time-travel (settlement scripting)', async () => {
    setTestClock('2026-07-19T15:00:00Z');
    const adapter = new MockVenueAdapter();
    adapter.addMarket({ venueMarketId: 'M' });
    adapter.scheduleResolution('M', new Date('2026-07-19T20:00:00Z'), 'no');

    expect(await adapter.getResolution('M')).toEqual({ state: 'unresolved' });
    setTestClock('2026-07-19T20:00:01Z');
    expect(await adapter.getResolution('M')).toEqual({ state: 'resolved', outcome: 'no' });
  });

  it('injects one-shot failures for outage-posture tests (§7.5)', async () => {
    const adapter = new MockVenueAdapter();
    adapter.addMarket({ venueMarketId: 'M' });
    adapter.failNext('getYesPrice');
    await expect(adapter.getYesPrice('M')).rejects.toThrow('mock venue outage');
    // Next call succeeds again.
    expect(await adapter.getYesPrice('M')).not.toBeNull();
  });

  it('excludes resolved/voided markets from candidate listings', async () => {
    const adapter = new MockVenueAdapter();
    adapter
      .addMarket({ venueMarketId: 'A', liquidityUsd: 1000 })
      .addMarket({ venueMarketId: 'B', liquidityUsd: 1000 })
      .resolve('B', 'yes');
    const listed = await adapter.listCandidateMarkets({
      closesWithinH: [0, 48],
      minLiquidityUsd: 0,
      limit: 10,
    });
    expect(listed.map((m) => m.venueMarketId)).toEqual(['A']);
  });

  it('filters by liquidity floor and close window', async () => {
    setTestClock('2026-07-19T00:00:00Z');
    const adapter = new MockVenueAdapter();
    adapter
      .addMarket({ venueMarketId: 'SOON', closeTime: new Date('2026-07-19T06:00:00Z'), liquidityUsd: 1000 })
      .addMarket({ venueMarketId: 'LATER', closeTime: new Date('2026-07-25T00:00:00Z'), liquidityUsd: 1000 })
      .addMarket({ venueMarketId: 'ILLIQUID', closeTime: new Date('2026-07-19T06:00:00Z'), liquidityUsd: 5 });
    const listed = await adapter.listCandidateMarkets({
      closesWithinH: [0, 24],
      minLiquidityUsd: 100,
      limit: 10,
    });
    expect(listed.map((m) => m.venueMarketId)).toEqual(['SOON']);
  });
});
