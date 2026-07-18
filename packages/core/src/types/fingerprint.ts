/**
 * Fingerprint domain types (design doc §5.4 `fingerprints`, §8.1–8.2).
 * The pure computation lives in `packages/engine` (WS4); these are the shared shapes.
 */
import type { MarketCategory } from '../enums.js';

/**
 * Prior axes seeded from placement and/or wallet import (§8.7, §12.4). Per-axis optional:
 * placement can never seed `timing` (§8.7); priors never touch accuracy/edge/brier (INV-5).
 */
export interface FingerprintPrior {
  chalk?: number;
  contrarian?: number;
  timing?: number;
  categoryShares?: Partial<Record<MarketCategory, number>>;
}

/** One profile's nightly-rebuilt fingerprint (§5.4). */
export interface FingerprintVector {
  /** n used for shrinkage. */
  resolvedPickCount: number;
  /** §8.1; null if n=0. */
  brier: number | null;
  /** wins / resolved; null if n=0. */
  accuracy: number | null;
  edgeMean: number | null;
  /** [−1,1], shrunk. */
  chalk: number;
  /** [−1,1], shrunk. */
  contrarian: number;
  /** [−1,1], shrunk. */
  timing: number;
  /** Sums to 1 over picked categories. */
  categoryShares: Partial<Record<MarketCategory, number>>;
  /** Per-category accuracy where category n ≥ 5, else omitted. */
  categoryAccuracy: Partial<Record<MarketCategory, number>>;
  /** Null until `confidence_slider` ships. */
  calibration: unknown | null;
  placementPrior: FingerprintPrior | null;
  computedAt: Date;
}

/** Dimension order of the §8.2 style vector. */
export const STYLE_VECTOR_DIMS = [
  'chalk',
  'contrarian',
  'timing',
  'share_sports',
  'share_politics',
  'share_economics',
  'share_culture',
  'share_science',
  'share_other',
] as const;

export type StyleVector = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
