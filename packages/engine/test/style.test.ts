/**
 * WS4-T3 AC: zero-vector guards; symmetry; hand-checked examples.
 */
import { describe, expect, it } from 'vitest';
import { W_CAT, W_CHALK, W_CONTRA, W_TIMING } from '@receipts/core';
import { buildStyleVector, categoryOverlap, complementarity, styleDistance } from '../src/style.js';
import type { StyleInputs } from '../src/style.js';

function fp(overrides: Partial<StyleInputs> = {}): StyleInputs {
  return {
    chalk: 0,
    contrarian: 0,
    timing: 0,
    categoryShares: {},
    ...overrides,
  };
}

describe('buildStyleVector', () => {
  it('applies the pinned weights in STYLE_VECTOR_DIMS order', () => {
    const v = buildStyleVector(
      fp({ chalk: 0.4, contrarian: -0.2, timing: 0.6, categoryShares: { sports: 0.5, politics: 0.5 } }),
    );
    expect(v).toEqual([
      0.4 * W_CHALK,
      -0.2 * W_CONTRA,
      0.6 * W_TIMING,
      0.5 * W_CAT, // sports
      0.5 * W_CAT, // politics
      0 * W_CAT, // economics
      0 * W_CAT, // culture
      0 * W_CAT, // science
      0 * W_CAT, // other
    ]);
  });
});

describe('styleDistance', () => {
  it('is 0 for identical vectors', () => {
    const v = buildStyleVector(fp({ chalk: 0.5, categoryShares: { sports: 1 } }));
    expect(styleDistance(v, v)).toBeCloseTo(0, 10);
  });

  it('is symmetric', () => {
    const a = buildStyleVector(fp({ chalk: 0.6, contrarian: 0.2, categoryShares: { sports: 0.7, politics: 0.3 } }));
    const b = buildStyleVector(fp({ chalk: -0.3, contrarian: 0.5, categoryShares: { culture: 1 } }));
    expect(styleDistance(a, b)).toBeCloseTo(styleDistance(b, a), 12);
  });

  it('zero-vector guard: either vector all-zero returns the 0.5 neutral distance', () => {
    const zero = buildStyleVector(fp());
    const nonZero = buildStyleVector(fp({ chalk: 0.9 }));
    expect(styleDistance(zero, nonZero)).toBe(0.5);
    expect(styleDistance(nonZero, zero)).toBe(0.5);
    expect(styleDistance(zero, zero)).toBe(0.5);
  });

  it('hand-checked: orthogonal 2-axis vectors give distance 1 (cosine 0)', () => {
    // chalk-only vs contrarian-only style vectors are orthogonal
    const a = buildStyleVector(fp({ chalk: 1 }));
    const b = buildStyleVector(fp({ contrarian: 1 }));
    expect(styleDistance(a, b)).toBeCloseTo(1, 10);
  });

  it('hand-checked: opposite vectors give distance 2 (cosine -1)', () => {
    const a = buildStyleVector(fp({ chalk: 1 }));
    const b = buildStyleVector(fp({ chalk: -1 }));
    expect(styleDistance(a, b)).toBeCloseTo(2, 10);
  });
});

describe('categoryOverlap', () => {
  it('sums the per-category minimum', () => {
    const overlap = categoryOverlap({ sports: 0.6, politics: 0.4 }, { sports: 0.3, politics: 0.5, culture: 0.2 });
    expect(overlap).toBeCloseTo(0.3 + 0.4, 10); // min(0.6,0.3)+min(0.4,0.5)+min(0,0.2)
  });

  it('is 0 for disjoint category sets and 1 for identical shares', () => {
    expect(categoryOverlap({ sports: 1 }, { politics: 1 })).toBe(0);
    expect(categoryOverlap({ sports: 0.4, culture: 0.6 }, { sports: 0.4, culture: 0.6 })).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    const a = { sports: 0.7, science: 0.3 };
    const b = { sports: 0.2, science: 0.1, other: 0.7 };
    expect(categoryOverlap(a, b)).toBeCloseTo(categoryOverlap(b, a), 12);
  });
});

describe('complementarity', () => {
  it('hand-checked: identical chalk + identical category vectors -> 0', () => {
    const a = { chalk: 0.4, categoryShares: { sports: 1 } };
    const b = { chalk: 0.4, categoryShares: { sports: 1 } };
    expect(complementarity(a, b)).toBeCloseTo(0, 10);
  });

  it('hand-checked: max chalk delta (2) and orthogonal categories -> 1', () => {
    const a = { chalk: 1, categoryShares: { sports: 1 } };
    const b = { chalk: -1, categoryShares: { politics: 1 } };
    // 0.5*(|1-(-1)|/2) + 0.5*(1-0) = 0.5*1 + 0.5*1 = 1
    expect(complementarity(a, b)).toBeCloseTo(1, 10);
  });

  it('zero-vector guard: empty category shares contribute the 0.5 neutral term', () => {
    const a = { chalk: 0, categoryShares: {} };
    const b = { chalk: 0, categoryShares: { sports: 1 } };
    // chalk term = 0; cat term = 0.5 (guard) -> total = 0.5*0 + 0.5*0.5 = 0.25
    expect(complementarity(a, b)).toBeCloseTo(0.25, 10);
  });

  it('is symmetric', () => {
    const a = { chalk: 0.3, categoryShares: { sports: 0.6, culture: 0.4 } };
    const b = { chalk: -0.5, categoryShares: { sports: 0.1, science: 0.9 } };
    expect(complementarity(a, b)).toBeCloseTo(complementarity(b, a), 12);
  });
});
