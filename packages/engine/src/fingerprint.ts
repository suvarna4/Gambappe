/**
 * Fingerprint metrics (design doc §8.1). Pure function over a profile's graded, non-void picks.
 * No DB, no clock reads — `computedAt` is supplied by the caller.
 */
import { CROWD_MIN_N, PRIOR_WEIGHT, SHRINK_K } from '@receipts/core';
import type { FingerprintPrior, FingerprintVector } from '@receipts/core';
import type { MarketCategory, MarketSide } from '@receipts/core';

/** One graded, non-void pick as needed by the §8.1 formulas. */
export interface GradedPickInput {
  side: MarketSide;
  /** Live yes-price at pick time (`picks.yes_price_at_entry`), in [0,1]. */
  yesPriceAtEntry: number;
  /** Graded outcome: true = win, false = loss. Void picks must be filtered out before calling. */
  won: boolean;
  category: MarketCategory;
  pickedAt: Date;
  questionOpenAt: Date;
  questionLockAt: Date;
  /** Crowd split snapshotted at lock. Absent/zero-count questions are simply below CROWD_MIN_N. */
  lockCrowd: { yes: number; no: number };
}

const ALL_CATEGORIES: readonly MarketCategory[] = [
  'sports',
  'politics',
  'economics',
  'culture',
  'science',
  'other',
];

/** Implied probability of the chosen side (§8.1: side='yes' ? p : 1-p). */
function impliedProbability(pick: GradedPickInput): number {
  return pick.side === 'yes' ? pick.yesPriceAtEntry : 1 - pick.yesPriceAtEntry;
}

function shrink(raw: number, n: number): number {
  return raw * (n / (n + SHRINK_K));
}

/**
 * Blend a shrunk style axis with its prior counterpart (§8.1). Only called when the prior
 * actually carries that axis — placement priors never have `timing`.
 */
function blendWithPrior(shrunkAxis: number, priorAxis: number, n: number): number {
  return (n * shrunkAxis + PRIOR_WEIGHT * priorAxis) / (n + PRIOR_WEIGHT);
}

/**
 * Computes a profile's fingerprint from its graded, non-void picks (§8.1). `prior` is the
 * placement/wallet-import prior (§8.7/§12), blended per-axis into chalk/contrarian/timing only —
 * it never touches accuracy/edge/brier (INV-5). `computedAt` is a caller-supplied timestamp
 * (this package never reads the clock).
 */
export function computeFingerprint(
  picks: readonly GradedPickInput[],
  prior: FingerprintPrior | null | undefined,
  computedAt: Date,
): FingerprintVector {
  const n = picks.length;

  let accuracy: number | null = null;
  let brier: number | null = null;
  let edgeMean: number | null = null;
  let chalkRaw = 0;
  let timingRaw = 0;
  let contrarianRaw = 0;

  const categoryCounts = new Map<MarketCategory, number>();
  const categoryWins = new Map<MarketCategory, number>();

  if (n > 0) {
    let winSum = 0;
    let brierSum = 0;
    let edgeSum = 0;
    let pSum = 0;
    let timingSum = 0;
    let eligibleCrowdCount = 0;
    let minorityCount = 0;

    for (const pick of picks) {
      const w = pick.won ? 1 : 0;
      const p = impliedProbability(pick);
      winSum += w;
      brierSum += 1 - w;
      edgeSum += w - p;
      pSum += p;

      const openMs = pick.questionOpenAt.getTime();
      const lockMs = pick.questionLockAt.getTime();
      const denom = lockMs - openMs;
      const rawFraction = denom > 0 ? (pick.pickedAt.getTime() - openMs) / denom : 0;
      timingSum += Math.min(1, Math.max(0, rawFraction));

      const crowdN = pick.lockCrowd.yes + pick.lockCrowd.no;
      if (crowdN >= CROWD_MIN_N) {
        eligibleCrowdCount += 1;
        const chosenSideCount = pick.side === 'yes' ? pick.lockCrowd.yes : pick.lockCrowd.no;
        const chosenShare = chosenSideCount / crowdN;
        if (chosenShare < 0.5) minorityCount += 1;
      }

      categoryCounts.set(pick.category, (categoryCounts.get(pick.category) ?? 0) + 1);
      categoryWins.set(pick.category, (categoryWins.get(pick.category) ?? 0) + w);
    }

    accuracy = winSum / n;
    brier = brierSum / n;
    edgeMean = edgeSum / n;
    chalkRaw = 2 * (pSum / n) - 1;
    timingRaw = 2 * (timingSum / n) - 1;
    contrarianRaw = eligibleCrowdCount > 0 ? 2 * (minorityCount / eligibleCrowdCount) - 1 : 0;
  }

  let chalk = shrink(chalkRaw, n);
  let contrarian = shrink(contrarianRaw, n);
  let timing = shrink(timingRaw, n);

  if (prior) {
    if (prior.chalk !== undefined) chalk = blendWithPrior(chalk, prior.chalk, n);
    if (prior.contrarian !== undefined) contrarian = blendWithPrior(contrarian, prior.contrarian, n);
    if (prior.timing !== undefined) timing = blendWithPrior(timing, prior.timing, n);
  }

  const categoryShares: Partial<Record<MarketCategory, number>> = {};
  const categoryAccuracy: Partial<Record<MarketCategory, number>> = {};
  if (n > 0) {
    for (const category of ALL_CATEGORIES) {
      const count = categoryCounts.get(category);
      if (count === undefined) continue;
      categoryShares[category] = count / n;
      if (count >= 5) {
        const wins = categoryWins.get(category) ?? 0;
        categoryAccuracy[category] = wins / count;
      }
    }
  }

  return {
    resolvedPickCount: n,
    brier,
    accuracy,
    edgeMean,
    chalk,
    contrarian,
    timing,
    categoryShares,
    categoryAccuracy,
    calibration: null,
    placementPrior: prior ?? null,
    computedAt,
  };
}
