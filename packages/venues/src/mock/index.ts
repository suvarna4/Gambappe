/**
 * MockVenueAdapter (WS0-T6): scriptable prices/resolutions for every downstream task
 * (§0.2 "mocks unblock you", §7.1). Time-sensitive scripting reads `now()` from
 * @receipts/core clock, so TEST_CLOCK time-travel (§17.2) drives scheduled price moves and
 * resolutions in E2E.
 */
import {
  now,
  YES_PRICE_MAX,
  YES_PRICE_MIN,
  type CandidateMarketQuery,
  type MarketCategory,
  type MarketSide,
  type NormalizedMarket,
  type Venue,
  type VenuePriceQuote,
  type VenueResolution,
} from '@receipts/core';
import type { VenueAdapter } from '../adapter.js';

export interface MockMarketInput {
  venueMarketId: string;
  title?: string;
  category?: MarketCategory;
  closeTime?: Date;
  expectedResolveTime?: Date;
  yesPrice?: number;
  liquidityUsd?: number;
  venueUrl?: string;
  /**
   * Outcome labels as the venue reports them. Anything other than exactly two outcomes marks
   * the market multi-outcome and it is EXCLUDED from listings (DD-7) and getMarket.
   */
  outcomes?: string[];
  raw?: unknown;
}

interface ScheduledPrice {
  at: Date;
  yesPrice: number;
}

interface ScheduledResolution {
  at: Date;
  resolution: VenueResolution;
}

interface MockMarketState {
  market: NormalizedMarket;
  binary: boolean;
  priceTs: Date;
  scheduledPrices: ScheduledPrice[];
  resolution: VenueResolution;
  scheduledResolution: ScheduledResolution | null;
}

function clampPrice(p: number): number {
  return Math.min(YES_PRICE_MAX, Math.max(YES_PRICE_MIN, p));
}

export class MockVenueAdapter implements VenueAdapter {
  readonly venue: Venue;
  private markets = new Map<string, MockMarketState>();
  private failNextCalls = new Map<string, Error>();

  constructor(venue: Venue = 'kalshi') {
    this.venue = venue;
  }

  // --- scripting surface ----------------------------------------------------------------

  addMarket(input: MockMarketInput): this {
    const ts = now();
    const binary = input.outcomes === undefined || input.outcomes.length === 2;
    const market: NormalizedMarket = {
      venue: this.venue,
      venueMarketId: input.venueMarketId,
      title: input.title ?? `Mock market ${input.venueMarketId}`,
      category: input.category ?? 'other',
      closeTime: input.closeTime ?? new Date(ts.getTime() + 24 * 3600_000),
      ...(input.expectedResolveTime ? { expectedResolveTime: input.expectedResolveTime } : {}),
      yesPrice: clampPrice(input.yesPrice ?? 0.5),
      liquidityUsd: input.liquidityUsd ?? 10_000,
      venueUrl:
        input.venueUrl ?? `https://mock.${this.venue}.example/markets/${input.venueMarketId}`,
      raw: input.raw ?? { mock: true },
    };
    this.markets.set(input.venueMarketId, {
      market,
      binary,
      priceTs: ts,
      scheduledPrices: [],
      resolution: { state: 'unresolved' },
      scheduledResolution: null,
    });
    return this;
  }

  /** Set the live yes price immediately (clamped to [0.01, 0.99]). */
  setYesPrice(venueMarketId: string, yesPrice: number, ts: Date = now()): this {
    const state = this.mustGet(venueMarketId);
    state.market = { ...state.market, yesPrice: clampPrice(yesPrice) };
    state.priceTs = ts;
    return this;
  }

  /** Script a price that takes effect once `now()` reaches `at` (TEST_CLOCK-driven). */
  schedulePrice(venueMarketId: string, at: Date, yesPrice: number): this {
    this.mustGet(venueMarketId).scheduledPrices.push({ at, yesPrice: clampPrice(yesPrice) });
    return this;
  }

  /** Resolve immediately. */
  resolve(venueMarketId: string, outcome: MarketSide): this {
    const state = this.mustGet(venueMarketId);
    state.resolution = { state: 'resolved', outcome };
    state.market = { ...state.market };
    return this;
  }

  /** Void immediately. */
  void(venueMarketId: string): this {
    this.mustGet(venueMarketId).resolution = { state: 'voided' };
    return this;
  }

  /** Script a resolution that takes effect once `now()` reaches `at`. */
  scheduleResolution(
    venueMarketId: string,
    at: Date,
    resolution: VenueResolution | MarketSide,
  ): this {
    const value: VenueResolution =
      typeof resolution === 'string' ? { state: 'resolved', outcome: resolution } : resolution;
    this.mustGet(venueMarketId).scheduledResolution = { at, resolution: value };
    return this;
  }

  /** Make the next call of a method throw — venue-outage scripting (§7.5 failure posture). */
  failNext(method: keyof VenueAdapter, error: Error = new Error('mock venue outage')): this {
    this.failNextCalls.set(method, error);
    return this;
  }

  /** Remove all scripted markets. */
  reset(): this {
    this.markets.clear();
    this.failNextCalls.clear();
    return this;
  }

  // --- VenueAdapter ----------------------------------------------------------------------

  async listCandidateMarkets(q: CandidateMarketQuery): Promise<NormalizedMarket[]> {
    this.maybeFail('listCandidateMarkets');
    const t = now().getTime();
    const [minH, maxH] = q.closesWithinH;
    const results: NormalizedMarket[] = [];
    for (const state of this.markets.values()) {
      this.applySchedules(state);
      if (!state.binary) continue; // DD-7: multi-outcome structures filtered
      if (state.resolution.state !== 'unresolved') continue;
      const closesInH = (state.market.closeTime.getTime() - t) / 3600_000;
      if (closesInH < minH || closesInH > maxH) continue;
      if ((state.market.liquidityUsd ?? 0) < q.minLiquidityUsd) continue;
      results.push(state.market);
      if (results.length >= q.limit) break;
    }
    return results;
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    this.maybeFail('getMarket');
    const state = this.markets.get(venueMarketId);
    if (!state || !state.binary) return null;
    this.applySchedules(state);
    return state.market;
  }

  async getYesPrice(venueMarketId: string): Promise<VenuePriceQuote | null> {
    this.maybeFail('getYesPrice');
    const state = this.markets.get(venueMarketId);
    if (!state || !state.binary) return null;
    this.applySchedules(state);
    if (state.market.yesPrice === undefined) return null;
    return { yesPrice: state.market.yesPrice, ts: state.priceTs };
  }

  async getResolution(venueMarketId: string): Promise<VenueResolution> {
    this.maybeFail('getResolution');
    const state = this.markets.get(venueMarketId);
    if (!state) return { state: 'unresolved' }; // ambiguous → unresolved, never guess
    this.applySchedules(state);
    return state.resolution;
  }

  // --- internals -------------------------------------------------------------------------

  private mustGet(venueMarketId: string): MockMarketState {
    const state = this.markets.get(venueMarketId);
    if (!state) throw new Error(`MockVenueAdapter: unknown market ${venueMarketId}`);
    return state;
  }

  private applySchedules(state: MockMarketState): void {
    const t = now().getTime();
    // Scheduled prices: apply every due entry in order.
    if (state.scheduledPrices.length > 0) {
      const due = state.scheduledPrices
        .filter((p) => p.at.getTime() <= t)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      if (due.length > 0) {
        const latest = due[due.length - 1]!;
        state.market = { ...state.market, yesPrice: latest.yesPrice };
        state.priceTs = latest.at;
        state.scheduledPrices = state.scheduledPrices.filter((p) => p.at.getTime() > t);
      }
    }
    if (state.scheduledResolution && state.scheduledResolution.at.getTime() <= t) {
      state.resolution = state.scheduledResolution.resolution;
      state.scheduledResolution = null;
    }
  }

  private maybeFail(method: string): void {
    const err = this.failNextCalls.get(method);
    if (err) {
      this.failNextCalls.delete(method);
      throw err;
    }
  }
}
