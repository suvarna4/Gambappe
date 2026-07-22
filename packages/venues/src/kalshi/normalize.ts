/**
 * Kalshi market normalization (§7.3): binary filter (DD-7), price conversion to [0,1],
 * resolution mapping. Never guesses — anything ambiguous is `unresolved`.
 *
 * WS15-T1: the current API serves dollar-string price/liquidity fields
 * (`yes_bid_dollars: "0.9800"`) — already probabilities, no cents division — with the legacy
 * integer-cents fields gone. Every reader here prefers the dollars generation and falls back
 * to legacy cents (recorded fixtures, older gateways). See `schemas.ts` header.
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

/** "0.9800" | 0.98 | null | undefined → number | undefined (NaN never leaks). */
function toNumber(v: string | number | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Midpoint of yes bid/ask when both present, else last price (§7.3) → [0.01,0.99].
 * Dollars fields (already probabilities) win over legacy cents. */
export function kalshiYesPrice(market: KalshiMarket): number | undefined {
  const bidD = toNumber(market.yes_bid_dollars);
  const askD = toNumber(market.yes_ask_dollars);
  if (bidD !== undefined && askD !== undefined) return clampPrice((bidD + askD) / 2);
  const lastD = toNumber(market.last_price_dollars);
  if (lastD !== undefined) return clampPrice(lastD);

  const cents =
    market.yes_bid != null && market.yes_ask != null
      ? (market.yes_bid + market.yes_ask) / 2
      : (market.last_price ?? undefined);
  if (cents === undefined) return undefined;
  return centsToProb(cents);
}

/** Order-book liquidity in USD, from whichever generation of field is present. */
export function kalshiLiquidityUsd(market: KalshiMarket): number | undefined {
  const usd = toNumber(market.liquidity_dollars);
  if (usd !== undefined) return usd;
  return market.liquidity != null ? market.liquidity / 100 : undefined;
}

/** Contracts outstanding (fixed-point string preferred over the legacy int). */
function openInterestContracts(market: KalshiMarket): number | undefined {
  return toNumber(market.open_interest_fp) ?? toNumber(market.open_interest);
}

/**
 * Activity floor for candidate listing (WS15-T1). The live scan found `liquidity_dollars`
 * reported as 0 on every market of the public feed — including ones with an active order
 * book — so a liquidity-only floor would filter Kalshi to zero forever. Open interest ×
 * per-contract notional (USD actually at stake) is the reliably-populated signal, so the
 * floor passes on EITHER measure. `liquidityUsd` on the normalized market stays the honest
 * order-book number (`kalshiLiquidityUsd`) — this proxy is for filtering only, never stored
 * as liquidity.
 */
export function kalshiActivityUsd(market: KalshiMarket): number {
  const liquidity = kalshiLiquidityUsd(market) ?? 0;
  const notional = toNumber(market.notional_value_dollars) ?? 1;
  const openInterestUsd = (openInterestContracts(market) ?? 0) * notional;
  return Math.max(liquidity, openInterestUsd);
}

/**
 * Market status settled/finalized + result side → resolved/voided; anything ambiguous stays
 * unresolved (never guess, §7.3). Live-verified (WS15-T1): settled markets report
 * `status: "finalized"` with `result: "yes" | "no"`. The exact 'void' result token remains
 * unverified against a live voided market — see fixtures/venue-notes.md.
 */
export function kalshiResolution(market: KalshiMarket): VenueResolution {
  const status = market.status;
  // 'determined' (WS15-T11, live-verified 2026-07-22): Kalshi's outcome-known-settlement-pending
  // state — the market carries its final result (a staging daily sat at determined/yes for
  // hours while this list rejected it, so settle-on-resolution never fired). The never-guess
  // rule is preserved by the result check below: 'determined' with an empty/unknown result
  // token still returns unresolved.
  if (status !== 'settled' && status !== 'finalized' && status !== 'determined') {
    return { state: 'unresolved' };
  }
  const result = (market.result ?? '').trim().toLowerCase();
  if (result === 'yes' || result === 'no') return { state: 'resolved', outcome: result };
  if (result === 'void' || result === 'voided') return { state: 'voided' };
  return { state: 'unresolved' };
}

function venueUrl(ticker: string): string {
  return `https://kalshi.com/markets/${ticker}`;
}

/** Trimmed payload only — never the full response (ToS posture, §5.3 `raw`). Open interest /
 * 24h volume ride along for curator context since `liquidity_usd` is 0 on the public feed. */
function trimmedRaw(market: KalshiMarket): unknown {
  return {
    ticker: market.ticker,
    event_ticker: market.event_ticker,
    status: market.status,
    result: market.result,
    category: market.category,
    open_interest: openInterestContracts(market),
    volume_24h: toNumber(market.volume_24h_fp) ?? toNumber(market.volume_24h),
  };
}

export function normalizeKalshiMarket(market: KalshiMarket): NormalizedMarket {
  const yesPrice = kalshiYesPrice(market);
  const liquidityUsd = kalshiLiquidityUsd(market);
  const expectedResolveTime = market.expected_expiration_time ?? market.expiration_time;
  return {
    venue: 'kalshi',
    venueMarketId: market.ticker,
    title: market.title,
    category: mapKalshiCategory(market.category),
    closeTime: new Date(market.close_time),
    ...(expectedResolveTime ? { expectedResolveTime: new Date(expectedResolveTime) } : {}),
    ...(yesPrice !== undefined ? { yesPrice } : {}),
    ...(liquidityUsd !== undefined ? { liquidityUsd } : {}),
    venueUrl: venueUrl(market.ticker),
    raw: trimmedRaw(market),
  };
}
