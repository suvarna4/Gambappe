/**
 * Shared VenueAdapter contract-test suite (WS0-T6 owns this; §7.1, §19.3).
 * Every adapter — mock (WS0) and real kalshi/polymarket (WS1, against recorded fixtures) —
 * must pass it. Import inside a vitest file and call with a harness.
 */
import { describe, expect, it } from 'vitest';
import { normalizedMarketSchema, VENUE, YES_PRICE_MAX, YES_PRICE_MIN } from '@receipts/core';
import type { VenueAdapter } from './adapter.js';

export interface AdapterContractContext {
  adapter: VenueAdapter;
  /** Listed, open, priced binary market. */
  knownMarketId: string;
  /** Market whose resolution is {state:'resolved', outcome:'yes'}. */
  resolvedYesMarketId: string;
  /** Market whose resolution is {state:'voided'}. */
  voidedMarketId: string;
  /** Id the venue has never heard of. */
  unknownMarketId: string;
  /** A candidate query that must return knownMarketId among results. */
  candidateQuery: { closesWithinH: [number, number]; minLiquidityUsd: number; limit: number };
}

export interface AdapterContractHarness {
  name: string;
  setup(): AdapterContractContext | Promise<AdapterContractContext>;
}

export function runVenueAdapterContractSuite(harness: AdapterContractHarness): void {
  describe(`VenueAdapter contract: ${harness.name}`, () => {
    it('declares a known venue', async () => {
      const { adapter } = await harness.setup();
      expect(VENUE).toContain(adapter.venue);
    });

    it('lists candidate markets as valid NormalizedMarkets of its own venue', async () => {
      const { adapter, candidateQuery, knownMarketId } = await harness.setup();
      const markets = await adapter.listCandidateMarkets(candidateQuery);
      expect(markets.length).toBeGreaterThan(0);
      expect(markets.length).toBeLessThanOrEqual(candidateQuery.limit);
      for (const market of markets) {
        const parsed = normalizedMarketSchema.parse(market);
        expect(parsed.venue).toBe(adapter.venue);
      }
      expect(markets.map((m) => m.venueMarketId)).toContain(knownMarketId);
    });

    it('respects the limit parameter', async () => {
      const { adapter, candidateQuery } = await harness.setup();
      const markets = await adapter.listCandidateMarkets({ ...candidateQuery, limit: 1 });
      expect(markets.length).toBeLessThanOrEqual(1);
    });

    it('getMarket returns the normalized market, or null for unknown ids', async () => {
      const { adapter, knownMarketId, unknownMarketId } = await harness.setup();
      const market = await adapter.getMarket(knownMarketId);
      expect(market).not.toBeNull();
      expect(normalizedMarketSchema.parse(market).venueMarketId).toBe(knownMarketId);
      expect(await adapter.getMarket(unknownMarketId)).toBeNull();
    });

    it('getYesPrice returns a clamped [0.01,0.99] quote with a timestamp', async () => {
      const { adapter, knownMarketId, unknownMarketId } = await harness.setup();
      const quote = await adapter.getYesPrice(knownMarketId);
      expect(quote).not.toBeNull();
      expect(quote!.yesPrice).toBeGreaterThanOrEqual(YES_PRICE_MIN);
      expect(quote!.yesPrice).toBeLessThanOrEqual(YES_PRICE_MAX);
      expect(quote!.ts).toBeInstanceOf(Date);
      expect(await adapter.getYesPrice(unknownMarketId)).toBeNull();
    });

    it('reports unresolved for open markets (never guesses)', async () => {
      const { adapter, knownMarketId } = await harness.setup();
      expect(await adapter.getResolution(knownMarketId)).toEqual({ state: 'unresolved' });
    });

    it('reports resolved with an outcome side', async () => {
      const { adapter, resolvedYesMarketId } = await harness.setup();
      expect(await adapter.getResolution(resolvedYesMarketId)).toEqual({
        state: 'resolved',
        outcome: 'yes',
      });
    });

    it('reports voided markets', async () => {
      const { adapter, voidedMarketId } = await harness.setup();
      expect(await adapter.getResolution(voidedMarketId)).toEqual({ state: 'voided' });
    });

    it('treats unknown ids as unresolved (ambiguity is never guessed)', async () => {
      const { adapter, unknownMarketId } = await harness.setup();
      expect(await adapter.getResolution(unknownMarketId)).toEqual({ state: 'unresolved' });
    });
  });
}
