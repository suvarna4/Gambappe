/**
 * Normalized venue market types (design doc §7.1). The VenueAdapter interface itself lives in
 * `packages/venues` (§4.1); these are the cross-package data shapes.
 */
import { z } from 'zod';
import { MARKET_CATEGORY, MARKET_SIDE, VENUE } from '../enums.js';
import type { MarketCategory, MarketSide, Venue } from '../enums.js';

/**
 * A venue market normalized by an adapter. Only strictly binary markets are ever produced
 * (DD-7); prices are always the probability of YES clamped to [0.01, 0.99] — adapters reject
 * 0/1 until resolution (§7.1).
 */
export interface NormalizedMarket {
  venue: Venue;
  venueMarketId: string;
  title: string;
  category: MarketCategory;
  closeTime: Date;
  expectedResolveTime?: Date;
  yesPrice?: number;
  liquidityUsd?: number;
  venueUrl: string;
  /** Trimmed venue payload — only fields needed for debugging/normalization (§5.3 `raw`). */
  raw: unknown;
}

export const YES_PRICE_MIN = 0.01;
export const YES_PRICE_MAX = 0.99;

export const normalizedMarketSchema = z.object({
  venue: z.enum(VENUE),
  venueMarketId: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(MARKET_CATEGORY),
  closeTime: z.date(),
  expectedResolveTime: z.date().optional(),
  yesPrice: z.number().min(YES_PRICE_MIN).max(YES_PRICE_MAX).optional(),
  liquidityUsd: z.number().nonnegative().optional(),
  venueUrl: z.string().url(),
  raw: z.unknown(),
});

/** Adapter resolution result (§7.1 getResolution). */
export type VenueResolution =
  | { state: 'unresolved' }
  | { state: 'resolved'; outcome: MarketSide }
  | { state: 'voided' };

export const venueResolutionSchema: z.ZodType<VenueResolution> = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unresolved') }),
  z.object({ state: z.literal('resolved'), outcome: z.enum(MARKET_SIDE) }),
  z.object({ state: z.literal('voided') }),
]);

/** Adapter price quote (§7.1 getYesPrice). */
export interface VenuePriceQuote {
  yesPrice: number;
  ts: Date;
}

export const venuePriceQuoteSchema: z.ZodType<VenuePriceQuote> = z.object({
  yesPrice: z.number().min(YES_PRICE_MIN).max(YES_PRICE_MAX),
  ts: z.date(),
});

/** Query shape for VenueAdapter.listCandidateMarkets (§7.1). */
export interface CandidateMarketQuery {
  /** Markets whose close time falls within [min, max] hours from now. */
  closesWithinH: [number, number];
  minLiquidityUsd: number;
  limit: number;
}
