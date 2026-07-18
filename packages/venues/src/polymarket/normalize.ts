/**
 * Polymarket market normalization (§7.4): binary filter (DD-7 — `outcomes = ["Yes","No"]`),
 * Gamma `outcomePrices` fallback price, resolution mapping. Never guesses.
 */
import {
  YES_PRICE_MAX,
  YES_PRICE_MIN,
  type NormalizedMarket,
  type VenueResolution,
} from '@receipts/core';
import { mapPolymarketCategory } from './category-map.js';
import type { PolymarketGammaMarket } from './schemas.js';

export function clampPrice(p: number): number {
  return Math.min(YES_PRICE_MAX, Math.max(YES_PRICE_MIN, p));
}

/** Binary iff outcomes is exactly `["Yes","No"]` (case-insensitive, order-independent). */
export function isBinaryPolymarketMarket(market: PolymarketGammaMarket): boolean {
  const outcomes = market.outcomes;
  if (!outcomes || outcomes.length !== 2) return false;
  const normalized = outcomes.map((o) => o.trim().toLowerCase());
  return normalized.includes('yes') && normalized.includes('no');
}

function yesIndex(outcomes: string[]): number {
  return outcomes.findIndex((o) => o.trim().toLowerCase() === 'yes');
}

function noIndex(outcomes: string[]): number {
  return outcomes.findIndex((o) => o.trim().toLowerCase() === 'no');
}

export function polymarketOutcomePrices(market: PolymarketGammaMarket): number[] | undefined {
  if (!market.outcomePrices) return undefined;
  return market.outcomePrices.map((p) => Number(p));
}

/** Gamma `outcomePrices` fallback (§7.4): the YES-labeled slot's price, clamped. */
export function polymarketGammaYesPrice(market: PolymarketGammaMarket): number | undefined {
  if (!market.outcomes) return undefined;
  const idx = yesIndex(market.outcomes);
  const prices = polymarketOutcomePrices(market);
  const price = idx >= 0 ? prices?.[idx] : undefined;
  if (price === undefined || Number.isNaN(price)) return undefined;
  return clampPrice(price);
}

/** CLOB token id for the YES outcome, used for the primary midpoint price source. */
export function polymarketYesTokenId(market: PolymarketGammaMarket): string | undefined {
  if (!market.outcomes || !market.clobTokenIds) return undefined;
  const idx = yesIndex(market.outcomes);
  if (idx < 0) return undefined;
  return market.clobTokenIds[idx];
}

function venueUrl(slugOrId: string): string {
  return `https://polymarket.com/event/${slugOrId}`;
}

/** Trimmed payload only — never the full response (ToS posture, §5.3 `raw`). */
function trimmedRaw(market: PolymarketGammaMarket): unknown {
  return {
    id: market.id,
    slug: market.slug,
    category: market.category,
    closed: market.closed,
    umaResolutionStatus: market.umaResolutionStatus,
  };
}

export function normalizeGammaMarket(
  market: PolymarketGammaMarket,
  yesPriceOverride?: number,
): NormalizedMarket {
  const yesPrice = yesPriceOverride ?? polymarketGammaYesPrice(market);
  return {
    venue: 'polymarket',
    venueMarketId: market.id,
    title: market.question,
    category: mapPolymarketCategory(market.category),
    closeTime: new Date(market.endDate),
    ...(yesPrice !== undefined ? { yesPrice } : {}),
    ...(market.liquidity != null ? { liquidityUsd: Number(market.liquidity) } : {}),
    venueUrl: venueUrl(market.slug ?? market.id),
    raw: trimmedRaw(market),
  };
}

const RESOLVED_HIGH = 0.99;
const RESOLVED_LOW = 0.01;
/** Both outcome tokens settling near zero indicates an invalidated/void market (SPEC-GAP —
 * this heuristic is unverified against a live payload, see fixtures/venue-notes.md). */
const VOID_MAX = 0.02;
const DISPUTE_STATUSES = new Set(['disputed', 'proposed', 'challenged']);

/**
 * `closed` + resolved outcome derived from `outcomePrices` (§7.4); disputes/UMA in-flight
 * (`umaResolutionStatus`) → unresolved. Anything that doesn't cleanly resolve stays
 * unresolved (never guess).
 */
export function polymarketResolution(market: PolymarketGammaMarket): VenueResolution {
  if (!market.closed) return { state: 'unresolved' };
  const uma = (market.umaResolutionStatus ?? '').trim().toLowerCase();
  if (DISPUTE_STATUSES.has(uma)) return { state: 'unresolved' };
  if (!market.outcomes || market.outcomes.length !== 2) return { state: 'unresolved' };
  const prices = polymarketOutcomePrices(market);
  if (!prices || prices.length !== 2 || prices.some((p) => Number.isNaN(p))) {
    return { state: 'unresolved' };
  }
  const idxYes = yesIndex(market.outcomes);
  const idxNo = noIndex(market.outcomes);
  if (idxYes < 0 || idxNo < 0) return { state: 'unresolved' };
  const pYes = prices[idxYes]!;
  const pNo = prices[idxNo]!;
  if (pYes <= VOID_MAX && pNo <= VOID_MAX) return { state: 'voided' };
  if (pYes >= RESOLVED_HIGH && pNo <= RESOLVED_LOW) return { state: 'resolved', outcome: 'yes' };
  if (pNo >= RESOLVED_HIGH && pYes <= RESOLVED_LOW) return { state: 'resolved', outcome: 'no' };
  return { state: 'unresolved' };
}
