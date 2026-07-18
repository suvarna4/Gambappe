/**
 * Wallet import bucketing + prior derivation (design doc §12.3–12.4, INV-7). Pure function:
 * plain position data in, `{enrichment, prior}` out — no DB, no clock reads, no network. This
 * is the ONLY place raw position notionals are ever looked at; `buildWalletEnrichment`'s output
 * `enrichment` object is exactly what `wallet_links.enrichment` persists, and it contains no
 * numeric field except bucket/category counts and the derived priors (§12.4's "unit test
 * asserts the persisted JSON contains no numeric fields except counts/priors" AC —
 * `packages/engine/test/wallet-bucketing.test.ts` is that test).
 */
import { WALLET_SIZE_BUCKETS } from '@receipts/core';
import type { FingerprintPrior, MarketCategory, WalletEnrichment, WalletSizeBucket } from '@receipts/core';

/** One imported Polymarket position, already resolved to our domain shapes (in-memory only). */
export interface WalletPositionInput {
  /** USD notional at entry (size × entry price) — used ONLY to pick a bucket, then discarded. */
  notionalUsd: number;
  /** Implied probability of the position's held side, [0,1] (mirrors §8.1's `p_i`). */
  entryProbability: number;
  category: MarketCategory;
  /**
   * Best-effort entry timestamp for `first_seen` (§12.4). Null when the data API response
   * didn't carry one for this position — degrades `first_seen` to null, never throws.
   */
  enteredAt: Date | null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Assigns a position's notional to a `WALLET_SIZE_BUCKETS` bucket (bounds used TRANSIENTLY —
 * §12.4). Buckets are declared in ascending bound order; the first bound the notional is
 * strictly below wins, falling through to `xl` (unbounded) otherwise.
 */
export function sizeBucket(notionalUsd: number): WalletSizeBucket {
  for (const b of WALLET_SIZE_BUCKETS) {
    if (b.maxUsdExclusive === null || notionalUsd < b.maxUsdExclusive) return b.bucket;
  }
  return 'xl';
}

function emptyBuckets(): Record<WalletSizeBucket, number> {
  return { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
}

/** `YYYY-MM` in UTC (§12.4 "since Nov 2024" display). */
function toYearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface WalletEnrichmentResult {
  enrichment: WalletEnrichment;
  /** Wallet-derived prior, ready to blend into `fingerprints.placement_prior` (§8.7/§12.4). */
  prior: FingerprintPrior;
}

/**
 * Buckets `positions` and derives the chalk/category priors (§12.4). Timing prior is always
 * omitted here — SPEC-GAP(WS12-T2): the Polymarket data API's positions endpoint doesn't expose
 * the market's open/lock window the §8.1 timing formula needs, and the doc explicitly allows
 * "best-effort; null if unavailable" for wallet-derived timing. `notionalUsd` values are read
 * once per position to pick a bucket and are never copied into the returned object.
 */
export function buildWalletEnrichment(
  positions: readonly WalletPositionInput[],
): WalletEnrichmentResult {
  const buckets = emptyBuckets();
  const categoryCounts = new Map<MarketCategory, number>();
  let probabilitySum = 0;
  let earliestMs: number | null = null;

  for (const position of positions) {
    buckets[sizeBucket(position.notionalUsd)] += 1;
    categoryCounts.set(position.category, (categoryCounts.get(position.category) ?? 0) + 1);
    probabilitySum += clamp(position.entryProbability, 0, 1);
    if (position.enteredAt) {
      const ms = position.enteredAt.getTime();
      if (earliestMs === null || ms < earliestMs) earliestMs = ms;
    }
  }

  const n = positions.length;
  const categories: Partial<Record<MarketCategory, number>> = {};
  for (const [category, count] of categoryCounts) categories[category] = count / n;

  // §8.1 chalk formula applied to entry probabilities: 2*(mean p)-1.
  const chalkPrior = n > 0 ? clamp(2 * (probabilitySum / n) - 1, -1, 1) : null;
  const firstSeen = earliestMs !== null ? toYearMonth(new Date(earliestMs)) : null;

  const enrichment: WalletEnrichment = { trades: n, buckets, categories, chalkPrior, firstSeen };

  const prior: FingerprintPrior = {};
  if (chalkPrior !== null) prior.chalk = chalkPrior;
  if (n > 0) prior.categoryShares = categories;

  return { enrichment, prior };
}

function average(a: number, b: number): number {
  return (a + b) / 2;
}

/**
 * Blend a wallet-derived prior into whatever `fingerprints.placement_prior` already holds
 * (§12.4: "average if both wallet and placement priors exist"). Per-axis: both present →
 * average; only one present → that one passes through unchanged. `categoryShares` blends
 * per-category the same way over the union of keys.
 *
 * SPEC-GAP(WS12-T2): the design doc doesn't specify whether category-share blending should be
 * a renormalized weighted merge (accounting for differing sample sizes behind each prior) or a
 * simple per-key average; this implements the latter (simplest reading of "average... exist"),
 * which does not guarantee the merged shares still sum to exactly 1. `computeFingerprint`
 * (§8.1) only ever reads whichever axes are present and never assumes a normalized simplex for
 * a prior (unlike a profile's own `categoryShares`), so this is safe but worth a human revisit
 * if wallet-import + placement double-seeding becomes common.
 */
export function blendWalletPriorIntoExisting(
  existing: FingerprintPrior | null | undefined,
  incoming: FingerprintPrior,
): FingerprintPrior {
  if (!existing) return incoming;
  const blended: FingerprintPrior = { ...existing };

  if (incoming.chalk !== undefined) {
    blended.chalk = existing.chalk !== undefined ? average(existing.chalk, incoming.chalk) : incoming.chalk;
  }
  if (incoming.contrarian !== undefined) {
    blended.contrarian =
      existing.contrarian !== undefined ? average(existing.contrarian, incoming.contrarian) : incoming.contrarian;
  }
  if (incoming.timing !== undefined) {
    blended.timing =
      existing.timing !== undefined ? average(existing.timing, incoming.timing) : incoming.timing;
  }
  if (incoming.categoryShares) {
    const merged: Partial<Record<MarketCategory, number>> = { ...(existing.categoryShares ?? {}) };
    for (const [category, share] of Object.entries(incoming.categoryShares) as [MarketCategory, number][]) {
      const existingShare = merged[category];
      merged[category] = existingShare !== undefined ? average(existingShare, share) : share;
    }
    blended.categoryShares = merged;
  }

  return blended;
}
