/**
 * WS4-T8 unit tests: stratified sampling (§8.7 "5 items ... stratified: ≥3 categories") and the
 * placement prior formula (§8.1 raw chalk/contrarian, no shrinkage). Pure functions only — no
 * DB. `apps/web/test/integration/placement-flow.test.ts` covers the DB-backed pieces.
 */
import { describe, expect, it } from 'vitest';
import {
  computePlacementPriorAxes,
  samplePlacementItems,
  stratifiedSample,
} from '@/lib/placement-service';

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32 — deterministic, decent distribution for test purposes.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

interface Item {
  id: string;
  category: string;
}

function buildPool(): Item[] {
  const categories = ['sports', 'politics', 'economics', 'culture', 'science', 'other'];
  const pool: Item[] = [];
  for (const category of categories) {
    for (let i = 0; i < 4; i++) {
      pool.push({ id: `${category}-${i}`, category });
    }
  }
  return pool; // 24 items across 6 categories
}

describe('stratifiedSample / samplePlacementItems (§8.7)', () => {
  it('returns exactly 5 items spanning at least 3 distinct categories', () => {
    const pool = buildPool();
    for (let seed = 1; seed <= 50; seed++) {
      const sample = samplePlacementItems(pool, seededRandom(seed));
      expect(sample).toHaveLength(5);
      const categories = new Set(sample.map((item) => item.category));
      expect(categories.size).toBeGreaterThanOrEqual(3);
      // No duplicate items within one sample.
      expect(new Set(sample.map((item) => item.id)).size).toBe(5);
    }
  });

  it('is not always the same 3 categories across repeated runs', () => {
    const pool = buildPool();
    const seenCategorySets = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const sample = samplePlacementItems(pool, seededRandom(seed));
      const categories = [...new Set(sample.map((item) => item.category))].sort().join(',');
      seenCategorySets.add(categories);
    }
    // With 6 categories and 50 varied seeds, a correct stratified-random sampler produces more
    // than one distinct category combination; a bug that always picks the same 3 would collapse
    // this to a single set.
    expect(seenCategorySets.size).toBeGreaterThan(1);
  });

  it('never returns more items than requested even when the pool is smaller than count', () => {
    const smallPool = buildPool().slice(0, 3); // 3 items, 3 categories
    const sample = stratifiedSample(smallPool, 5, 3, seededRandom(7));
    expect(sample).toHaveLength(3);
  });

  it('falls back to as many categories as exist when the pool has fewer than 3', () => {
    const pool: Item[] = [
      { id: 'a', category: 'sports' },
      { id: 'b', category: 'sports' },
      { id: 'c', category: 'politics' },
      { id: 'd', category: 'politics' },
      { id: 'e', category: 'sports' },
      { id: 'f', category: 'politics' },
    ];
    const sample = stratifiedSample(pool, 5, 3, seededRandom(3));
    expect(sample).toHaveLength(5);
    const categories = new Set(sample.map((item) => item.category));
    expect(categories.size).toBe(2); // can't do better than what's in the pool
  });
});

describe('computePlacementPriorAxes (§8.1 raw formulas, n=5, no shrinkage)', () => {
  it('returns null for an empty answer set', () => {
    expect(computePlacementPriorAxes([])).toBeNull();
  });

  it('hand-computed golden: 5 answers → chalk 0.2, contrarian -0.6', () => {
    // p_i = side='yes' ? historicalYesPrice : 1 - historicalYesPrice
    // chosenShare = side='yes' ? crowdYes% : 1 - crowdYes%; minority iff chosenShare < 0.5
    //
    // 1. yes @ price 0.70, crowd 65% yes → p=0.70, chosenShare=0.65 → majority
    // 2. no  @ price 0.30, crowd 30% yes → p=0.70, chosenShare=0.70 → majority
    // 3. yes @ price 0.20, crowd 15% yes → p=0.20, chosenShare=0.15 → MINORITY
    // 4. yes @ price 0.90, crowd 88% yes → p=0.90, chosenShare=0.88 → majority
    // 5. no  @ price 0.50, crowd 50% yes → p=0.50, chosenShare=0.50 → majority (tie, not < 0.5)
    //
    // pSum = 0.70+0.70+0.20+0.90+0.50 = 3.00; n=5 → chalk = 2*(3.00/5) - 1 = 0.2
    // minorityCount = 1 → contrarian = 2*(1/5) - 1 = -0.6
    const axes = computePlacementPriorAxes([
      { side: 'yes', historicalYesPrice: 0.7, historicalCrowdYesPct: 65 },
      { side: 'no', historicalYesPrice: 0.3, historicalCrowdYesPct: 30 },
      { side: 'yes', historicalYesPrice: 0.2, historicalCrowdYesPct: 15 },
      { side: 'yes', historicalYesPrice: 0.9, historicalCrowdYesPct: 88 },
      { side: 'no', historicalYesPrice: 0.5, historicalCrowdYesPct: 50 },
    ]);
    expect(axes).not.toBeNull();
    expect(axes!.chalk).toBeCloseTo(0.2, 10);
    expect(axes!.contrarian).toBeCloseTo(-0.6, 10);
  });

  it('all-favorite, all-majority picks → chalk near +1, contrarian = -1', () => {
    const axes = computePlacementPriorAxes([
      { side: 'yes', historicalYesPrice: 0.95, historicalCrowdYesPct: 95 },
      { side: 'yes', historicalYesPrice: 0.9, historicalCrowdYesPct: 90 },
      { side: 'no', historicalYesPrice: 0.05, historicalCrowdYesPct: 5 },
    ]);
    expect(axes).not.toBeNull();
    expect(axes!.chalk).toBeGreaterThan(0.8);
    expect(axes!.contrarian).toBe(-1);
  });

  it('all-underdog, all-minority picks → chalk near -1, contrarian = +1', () => {
    const axes = computePlacementPriorAxes([
      { side: 'yes', historicalYesPrice: 0.1, historicalCrowdYesPct: 10 },
      { side: 'no', historicalYesPrice: 0.9, historicalCrowdYesPct: 90 },
    ]);
    expect(axes).not.toBeNull();
    expect(axes!.chalk).toBeLessThan(-0.7);
    expect(axes!.contrarian).toBe(1);
  });

  it('never returns a timing key — placement can never seed timing (§8.7)', () => {
    const axes = computePlacementPriorAxes([
      { side: 'yes', historicalYesPrice: 0.5, historicalCrowdYesPct: 50 },
    ]);
    expect(axes).not.toHaveProperty('timing');
  });
});
