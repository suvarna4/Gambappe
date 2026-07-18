/**
 * Kalshi market normalization (§7.3): binary filter (DD-7), cents→[0,1] price conversion,
 * resolution mapping. Never guesses — anything ambiguous is `unresolved`.
 */
import {
  YES_PRICE_MAX,
  YES_PRICE_MIN,
  type NormalizedMarket,
  type VenueResolution,
} from '@receipts/core';
import { mapKalshiCategory } from './category-map.js';
import type { KalshiMarket } from './schemas.js';

/** Kalshi markets are inherently binary contracts (DD-7); anything else is excluded. */
export function isBinaryKalshiMarket(market: KalshiMarket): boolean {
  return market.market_type === undefined || market.market_type === 'binary';
}

export function clampPrice(p: number): number {
  return Math.min(YES_PRICE_MAX, Math.max(YES_PRICE_MIN, p));
}

/** Cents [0,100] → probability [0.01,0.99] (§7.3), shared by REST normalization and the
 * WS ticker's tick-level bid/ask updates (WS1-T6). */
export function centsToProb(cents: number): number {
  return clampPrice(cents / 100);
}

/** Midpoint of yes bid/ask when both present, else last price (§7.3); cents → [0,1]. */
export function kalshiYesPrice(market: KalshiMarket): number | undefined {
  const cents =
    market.yes_bid != null && market.yes_ask != null
      ? (market.yes_bid + market.yes_ask) / 2
      : (market.last_price ?? undefined);
  if (cents === undefined) return undefined;
  return centsToProb(cents);
}

/**
 * Market status settled/finalized + result side → resolved/voided; anything ambiguous stays
 * unresolved (never guess, §7.3). SPEC-GAP(WS1-T2): the exact 'void' result token Kalshi uses
 * for voided/no-contest markets could not be verified against live docs in this sandbox —
 * see fixtures/venue-notes.md.
 */
export function kalshiResolution(market: KalshiMarket): VenueResolution {
  const status = market.status;
  if (status !== 'settled' && status !== 'finalized') return { state: 'unresolved' };
  const result = (market.result ?? '').trim().toLowerCase();
  if (result === 'yes' || result === 'no') return { state: 'resolved', outcome: result };
  if (result === 'void' || result === 'voided') return { state: 'voided' };
  return { state: 'unresolved' };
}

function venueUrl(ticker: string): string {
  return `https://kalshi.com/markets/${ticker}`;
}

/** Trimmed payload only — never the full response (ToS posture, §5.3 `raw`). */
function trimmedRaw(market: KalshiMarket): unknown {
  return {
    ticker: market.ticker,
    event_ticker: market.event_ticker,
    status: market.status,
    result: market.result,
    category: market.category,
  };
}

export function normalizeKalshiMarket(market: KalshiMarket): NormalizedMarket {
  const yesPrice = kalshiYesPrice(market);
  return {
    venue: 'kalshi',
    venueMarketId: market.ticker,
    title: market.title,
    category: mapKalshiCategory(market.category),
    closeTime: new Date(market.close_time),
    ...(market.expiration_time ? { expectedResolveTime: new Date(market.expiration_time) } : {}),
    ...(yesPrice !== undefined ? { yesPrice } : {}),
    ...(market.liquidity != null ? { liquidityUsd: market.liquidity / 100 } : {}),
    venueUrl: venueUrl(market.ticker),
    raw: trimmedRaw(market),
  };
}
