/**
 * WS5-T1 unit test: `rankOverlappingCategories` (§8.8 "the pair's top overlapping categories"),
 * the pure piece of `apps/worker/src/lib/nemesis-bonus.ts`'s bonus-question category selection.
 */
import { describe, expect, it } from 'vitest';
import type { MarketCategory } from '@receipts/core';
import { rankOverlappingCategories } from '../src/lib/nemesis-bonus.js';

const CATEGORIES: MarketCategory[] = ['sports', 'politics', 'economics', 'culture', 'science', 'other'];

describe('rankOverlappingCategories (§8.2 categoryOverlap per category, §8.8)', () => {
  it('ranks by min(shareA, shareB) descending', () => {
    const a = { sports: 0.6, politics: 0.3, science: 0.1 };
    const b = { sports: 0.2, politics: 0.5, culture: 0.3 };
    // overlap: sports=min(0.6,0.2)=0.2, politics=min(0.3,0.5)=0.3, science=min(0.1,0)=0,
    // culture=min(0,0.3)=0, economics=0, other=0.
    const ranked = rankOverlappingCategories(CATEGORIES, a, b);
    expect(ranked[0]).toBe('politics');
    expect(ranked[1]).toBe('sports');
  });

  it('treats missing shares as 0 (no throw, stable ordering for zero-overlap categories)', () => {
    const a = { sports: 1 };
    const b = { sports: 1 };
    const ranked = rankOverlappingCategories(CATEGORIES, a, b);
    expect(ranked[0]).toBe('sports');
    expect(ranked).toHaveLength(CATEGORIES.length);
    expect(new Set(ranked)).toEqual(new Set(CATEGORIES)); // every category still present
  });

  it('is a no-op-safe pass over an empty overlap (all zeros) — returns all categories in some order', () => {
    const ranked = rankOverlappingCategories(CATEGORIES, {}, {});
    expect(ranked).toHaveLength(CATEGORIES.length);
  });
});
