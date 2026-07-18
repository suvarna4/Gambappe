/**
 * Style vector, distance & complementarity (design doc §8.2). Depends on WS4-T1's
 * `FingerprintVector` shape only — pure vector math, no I/O.
 */
import { MARKET_CATEGORY, W_CAT, W_CHALK, W_CONTRA, W_TIMING } from '@receipts/core';
import type { MarketCategory, StyleVector } from '@receipts/core';

/** Zero-vector guard threshold shared by styleDistance/complementarity (§8.2). */
const ZERO_NORM_EPSILON = 1e-6;

/** The subset of a fingerprint needed to build a style vector / run these comparisons. */
export interface StyleInputs {
  chalk: number;
  contrarian: number;
  timing: number;
  categoryShares: Partial<Record<MarketCategory, number>>;
}

/** Builds the §8.2 weighted style vector in the pinned `STYLE_VECTOR_DIMS` order. */
export function buildStyleVector(fingerprint: StyleInputs): StyleVector {
  const shares = MARKET_CATEGORY.map((c) => (fingerprint.categoryShares[c] ?? 0) * W_CAT) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [
    fingerprint.chalk * W_CHALK,
    fingerprint.contrarian * W_CONTRA,
    fingerprint.timing * W_TIMING,
    ...shares,
  ];
}

function dot(a: StyleVector, b: StyleVector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function norm(v: StyleVector): number {
  return Math.sqrt(dot(v, v));
}

function cosineSim(a: StyleVector, b: StyleVector): number {
  return dot(a, b) / (norm(a) * norm(b));
}

/** `1 − cosineSim(a,b)`; zero-vector guard → 0.5 neutral (§8.2). */
export function styleDistance(a: StyleVector, b: StyleVector): number {
  if (norm(a) < ZERO_NORM_EPSILON || norm(b) < ZERO_NORM_EPSILON) return 0.5;
  return 1 - cosineSim(a, b);
}

/** `Σ_c min(share_a[c], share_b[c])` ∈ [0,1] (§8.2). */
export function categoryOverlap(
  a: Partial<Record<MarketCategory, number>>,
  b: Partial<Record<MarketCategory, number>>,
): number {
  let sum = 0;
  for (const c of MARKET_CATEGORY) {
    sum += Math.min(a[c] ?? 0, b[c] ?? 0);
  }
  return sum;
}

function categoryVector(shares: Partial<Record<MarketCategory, number>>): number[] {
  return MARKET_CATEGORY.map((c) => shares[c] ?? 0);
}

function dotN(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function normN(v: number[]): number {
  return Math.sqrt(dotN(v, v));
}

/**
 * `0.5·(|chalk_a−chalk_b|/2) + 0.5·(1−cosineSim(cat_a,cat_b))` ∈ [0,1] (§8.2). Zero-vector
 * guard on the category vectors sets that half-term to 0.5 rather than dividing by zero.
 */
export function complementarity(
  a: Pick<StyleInputs, 'chalk' | 'categoryShares'>,
  b: Pick<StyleInputs, 'chalk' | 'categoryShares'>,
): number {
  const chalkTerm = Math.abs(a.chalk - b.chalk) / 2;

  const catA = categoryVector(a.categoryShares);
  const catB = categoryVector(b.categoryShares);
  const normA = normN(catA);
  const normB = normN(catB);
  const catTerm =
    normA < ZERO_NORM_EPSILON || normB < ZERO_NORM_EPSILON
      ? 0.5
      : 1 - dotN(catA, catB) / (normA * normB);

  return 0.5 * chalkTerm + 0.5 * catTerm;
}
