/**
 * The VenueAdapter contract (design doc §7.1) — owned by WS0-T6. WS1 builds the real
 * kalshi/polymarket adapters against this interface + the shared contract suite.
 */
import type {
  CandidateMarketQuery,
  NormalizedMarket,
  Venue,
  VenuePriceQuote,
  VenueResolution,
} from '@receipts/core';

export interface VenueAdapter {
  readonly venue: Venue;

  /**
   * Candidate markets for the curation pool. ONLY strictly binary markets are returned —
   * adapters filter multi-outcome structures (DD-7). Prices are always the probability of
   * YES in [0.01, 0.99]; adapters clamp and reject 0/1 until resolution.
   */
  listCandidateMarkets(q: CandidateMarketQuery): Promise<NormalizedMarket[]>;

  getMarket(venueMarketId: string): Promise<NormalizedMarket | null>;

  getYesPrice(venueMarketId: string): Promise<VenuePriceQuote | null>;

  /** Anything ambiguous → `unresolved` (never guess, §7.3/7.4). */
  getResolution(venueMarketId: string): Promise<VenueResolution>;
}

export type {
  CandidateMarketQuery,
  NormalizedMarket,
  VenuePriceQuote,
  VenueResolution,
} from '@receipts/core';
