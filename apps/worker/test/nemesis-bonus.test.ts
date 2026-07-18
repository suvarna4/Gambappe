/**
 * WS5-T1/WS5-T2 unit tests: the pure pieces of `apps/worker/src/lib/nemesis-bonus.ts`'s
 * bonus-question category selection (§8.8 "the pair's top overlapping categories") —
 * `rankOverlappingCategories`, `hasCategoryOverlap`, and `selectBonusMarketCandidates`. The
 * DB-backed authoring/dedup/0-bonus-fallback behavior is covered by the integration suite at
 * `apps/worker/test/integration/nemesis-bonus.test.ts` (WS5-T2 §19.3 AC).
 */
import { describe, expect, it } from 'vitest';
import type { MarketCategory } from '@receipts/core';
import { hasCategoryOverlap, rankOverlappingCategories, selectBonusMarketCandidates } from '../src/lib/nemesis-bonus.js';

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

describe('hasCategoryOverlap (§8.8 "top overlapping categories" — WS5-T2)', () => {
  it('is true when both members have a nonzero share in the category', () => {
    expect(hasCategoryOverlap('sports', { sports: 0.6 }, { sports: 0.1 })).toBe(true);
  });

  it('is false when either member has zero (or missing) share in the category', () => {
    expect(hasCategoryOverlap('sports', { sports: 1 }, { politics: 1 })).toBe(false);
    expect(hasCategoryOverlap('politics', {}, { politics: 1 })).toBe(false);
    expect(hasCategoryOverlap('culture', {}, {})).toBe(false);
  });
});

describe('selectBonusMarketCandidates (§8.8, WS5-T2 AC: category-overlap-driven selection)', () => {
  interface Candidate {
    id: string;
  }

  it('exhausts the higher-ranked category before considering a lower-ranked one', () => {
    const candidatesByCategory = new Map<MarketCategory, Candidate[]>([
      ['politics', [{ id: 'p1' }, { id: 'p2' }]],
      ['sports', [{ id: 's1' }, { id: 's2' }]],
    ]);
    // politics ranked ahead of sports (simulating higher category overlap).
    const selected = selectBonusMarketCandidates(['politics', 'sports'], candidatesByCategory, 3);
    expect(selected.map((c) => c.id)).toEqual(['p1', 'p2', 's1']); // politics fully drained first
  });

  it('never selects from a category absent from the ranked list, even if it has candidates', () => {
    const candidatesByCategory = new Map<MarketCategory, Candidate[]>([
      ['sports', [{ id: 's1' }]],
      ['culture', [{ id: 'c1' }]], // present in the map but NOT in rankedCategories (e.g. filtered out upstream)
    ]);
    const selected = selectBonusMarketCandidates(['sports'], candidatesByCategory, 5);
    expect(selected.map((c) => c.id)).toEqual(['s1']);
  });

  it('caps at maxCount across categories combined', () => {
    const candidatesByCategory = new Map<MarketCategory, Candidate[]>([
      ['sports', [{ id: 's1' }, { id: 's2' }, { id: 's3' }]],
      ['politics', [{ id: 'p1' }, { id: 'p2' }]],
    ]);
    const selected = selectBonusMarketCandidates(['sports', 'politics'], candidatesByCategory, 2);
    expect(selected.map((c) => c.id)).toEqual(['s1', 's2']);
  });

  it('deduplicates by id across categories (same market listed twice)', () => {
    const shared: Candidate = { id: 'm1' };
    const candidatesByCategory = new Map<MarketCategory, Candidate[]>([
      ['sports', [shared]],
      ['politics', [shared, { id: 'p2' }]],
    ]);
    const selected = selectBonusMarketCandidates(['sports', 'politics'], candidatesByCategory, 5);
    expect(selected.map((c) => c.id)).toEqual(['m1', 'p2']);
  });

  it('returns [] when rankedCategories is empty (0-bonus fallback, §8.8)', () => {
    const candidatesByCategory = new Map<MarketCategory, Candidate[]>([['sports', [{ id: 's1' }]]]);
    const selected = selectBonusMarketCandidates([], candidatesByCategory, 3);
    expect(selected).toEqual([]);
  });

  it('returns [] when no ranked category has any candidates (0-bonus fallback, §8.8)', () => {
    const selected = selectBonusMarketCandidates(['sports', 'politics'], new Map(), 3);
    expect(selected).toEqual([]);
  });
});
