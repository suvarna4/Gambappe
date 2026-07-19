/**
 * §8.6 daily percentile formula golden tests (WS3-T5 AC: "N=1, ties, all-wrong cases").
 */
import { describe, expect, it } from 'vitest';
import { computePercentiles, topPercentDisplay } from '../src/percentile.js';

describe('computePercentiles (§8.6)', () => {
  it('N=1 → 100 regardless of score', () => {
    expect(computePercentiles([0.4])).toEqual([100]);
    expect(computePercentiles([-1])).toEqual([100]);
  });

  it('N=0 → empty', () => {
    expect(computePercentiles([])).toEqual([]);
  });

  it('strictly ordered scores split evenly (no ties)', () => {
    // 4 participants, scores ascending: -1, -0.5, 0.5, 1 → percentiles 0, 33.33, 66.67, 100
    const result = computePercentiles([-1, -0.5, 0.5, 1]);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo((1 / 3) * 100, 5);
    expect(result[2]).toBeCloseTo((2 / 3) * 100, 5);
    expect(result[3]).toBeCloseTo(100, 5);
  });

  it('all-wrong (identical negative edges): everyone ties at the 50th percentile', () => {
    const result = computePercentiles([-0.6, -0.6, -0.6]);
    expect(result).toEqual([50, 50, 50]);
  });

  it('a tie among some, distinct others: ties split the tied band evenly', () => {
    // scores: 0 (win, chalk pick), 0, 1 (win, longshot) — the two 0s tie each other,
    // both strictly below the 1.
    const result = computePercentiles([0, 0, 1]);
    // For each 0: lower=0 (nothing below 0), tiedOthers=1 (the other 0) → (0+0.5)/2*100 = 25
    expect(result[0]).toBeCloseTo(25, 5);
    expect(result[1]).toBeCloseTo(25, 5);
    // For the 1: lower=2 (both 0s), tiedOthers=0 → (2+0)/2*100 = 100
    expect(result[2]).toBeCloseTo(100, 5);
  });

  it('is symmetric: reordering scores reorders results identically', () => {
    const a = computePercentiles([0.2, -0.3, 0.9, -0.3]);
    const b = computePercentiles([-0.3, -0.3, 0.2, 0.9]);
    expect(a[0]).toBeCloseTo(b[2]!, 5);
    expect(a[2]).toBeCloseTo(b[3]!, 5);
  });

  it('matches the pairwise §8.6 definition on tie-heavy pseudo-random inputs (differential)', () => {
    // Reference: the definition verbatim (the pre-optimization O(n²) implementation).
    function pairwiseReference(scores: readonly number[]): number[] {
      const n = scores.length;
      if (n === 0) return [];
      if (n === 1) return [100];
      return scores.map((sx, i) => {
        let lower = 0;
        let tiedOthers = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const sy = scores[j]!;
          if (sy < sx) lower++;
          else if (sy === sx) tiedOthers++;
        }
        return ((lower + 0.5 * tiedOthers) / (n - 1)) * 100;
      });
    }

    // Deterministic LCG so failures are reproducible; values drawn from a SMALL bucket set to
    // force heavy tie groups (the case the tie-group math must get exactly right).
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let trial = 0; trial < 25; trial++) {
      const n = 2 + Math.floor(rand() * 60);
      const scores = Array.from({ length: n }, () => Math.floor(rand() * 5) / 4 - 0.5);
      const expected = pairwiseReference(scores);
      const actual = computePercentiles(scores);
      expect(actual).toHaveLength(expected.length);
      for (let i = 0; i < n; i++) {
        expect(actual[i]).toBeCloseTo(expected[i]!, 10);
      }
    }
  });
});

describe('topPercentDisplay (§8.6 "Top X%")', () => {
  it('floors display at "Top 1%" even for percentile 100', () => {
    expect(topPercentDisplay(100)).toBe(1);
    expect(topPercentDisplay(99.6)).toBe(1);
  });

  it('X = 100 - percentile otherwise', () => {
    expect(topPercentDisplay(75)).toBe(25);
    expect(topPercentDisplay(0)).toBe(100);
  });
});
