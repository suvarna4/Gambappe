/**
 * Divergence flavor (§7.7, flag `divergence_display`): when a question has a
 * `paired_market_id` on the other venue, show both venues' yes-prices and the spread. Pure
 * display, no scoring impact — this is a pure computation, no DB/clock reads baked in (time
 * is a parameter, matching the `packages/engine` convention of §8).
 */
import { now, type Venue } from '@receipts/core';

export interface VenuePriceReading {
  venue: Venue;
  yesPrice: number;
  ts: Date;
}

export interface DivergenceResult {
  venueA: Venue;
  priceA: number;
  venueB: Venue;
  priceB: number;
  /** Absolute difference between the two venues' yes-prices. */
  spread: number;
}

/** Max price age for either side before the spread is hidden (§7.7 AC), ms. */
const DIVERGENCE_MAX_STALENESS_MS = 15 * 60_000;

function isFresh(ts: Date, at: Date): boolean {
  return at.getTime() - ts.getTime() <= DIVERGENCE_MAX_STALENESS_MS;
}

/**
 * Computes the venue spread iff BOTH readings are fresh (< 15 min old at `at`); otherwise
 * `null` — the UI shows no spread rather than a stale/misleading one.
 */
export function computeDivergence(
  a: VenuePriceReading,
  b: VenuePriceReading,
  at: Date = now(),
): DivergenceResult | null {
  if (!isFresh(a.ts, at) || !isFresh(b.ts, at)) return null;
  return {
    venueA: a.venue,
    priceA: a.yesPrice,
    venueB: b.venue,
    priceB: b.yesPrice,
    spread: Math.abs(a.yesPrice - b.yesPrice),
  };
}
