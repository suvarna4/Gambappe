/**
 * WS4-T1 AC: hand-computed vectors per metric; shrinkage at n=0/1/100; CROWD_MIN_N exclusion.
 */
import { describe, expect, it } from 'vitest';
import { CROWD_MIN_N, PRIOR_WEIGHT, SHRINK_K } from '@receipts/core';
import { computeFingerprint } from '../src/fingerprint.js';
import type { GradedPickInput } from '../src/fingerprint.js';

const OPEN = new Date('2026-07-13T13:00:00Z');
const LOCK = new Date('2026-07-13T16:00:00Z'); // 3h window
const COMPUTED_AT = new Date('2026-07-14T07:00:00Z');

function pickAtFraction(fraction: number, overrides: Partial<GradedPickInput> = {}): GradedPickInput {
  const pickedAt = new Date(OPEN.getTime() + fraction * (LOCK.getTime() - OPEN.getTime()));
  return {
    side: 'yes',
    yesPriceAtEntry: 0.7,
    won: true,
    category: 'sports',
    pickedAt,
    questionOpenAt: OPEN,
    questionLockAt: LOCK,
    lockCrowd: { yes: 0, no: 0 },
    ...overrides,
  };
}

describe('computeFingerprint — n=0', () => {
  it('null accuracy/edge/brier and neutral (zero) shrunk axes with no prior', () => {
    const fp = computeFingerprint([], null, COMPUTED_AT);
    expect(fp.resolvedPickCount).toBe(0);
    expect(fp.accuracy).toBeNull();
    expect(fp.edgeMean).toBeNull();
    expect(fp.brier).toBeNull();
    expect(fp.chalk).toBe(0);
    expect(fp.contrarian).toBe(0);
    expect(fp.timing).toBe(0);
    expect(fp.categoryShares).toEqual({});
    expect(fp.categoryAccuracy).toEqual({});
    expect(fp.computedAt).toBe(COMPUTED_AT);
  });

  it('n=0 with a prior blends to the prior value on axes it has (shrunk_axis=0)', () => {
    const fp = computeFingerprint([], { chalk: 0.5, contrarian: -0.4 }, COMPUTED_AT);
    // (0*0 + PRIOR_WEIGHT*prior) / (0 + PRIOR_WEIGHT) = prior
    expect(fp.chalk).toBeCloseTo(0.5, 10);
    expect(fp.contrarian).toBeCloseTo(-0.4, 10);
    expect(fp.timing).toBe(0); // prior has no timing axis — untouched
  });
});

describe('computeFingerprint — n=1 hand-computed', () => {
  // side=yes, yesPriceAtEntry=0.7 (p=0.7), won=true, picked at 30% of the open→lock window.
  const crowdEligible = { yes: 10, no: 15 }; // n=25 >= CROWD_MIN_N; chosen(yes) share = 10/25=0.4 <0.5 => minority
  const pick = pickAtFraction(0.3, { lockCrowd: crowdEligible });

  it('accuracy / brier / edge_mean', () => {
    const fp = computeFingerprint([pick], null, COMPUTED_AT);
    expect(fp.resolvedPickCount).toBe(1);
    expect(fp.accuracy).toBeCloseTo(1, 10); // 1 win / 1
    expect(fp.brier).toBeCloseTo(0, 10); // (1-1)/1
    expect(fp.edgeMean).toBeCloseTo(1 - 0.7, 10); // (w-p)/n
  });

  it('chalk raw=2*0.7-1=0.4, shrunk by n/(n+SHRINK_K)', () => {
    const fp = computeFingerprint([pick], null, COMPUTED_AT);
    const expectedShrunk = 0.4 * (1 / (1 + SHRINK_K));
    expect(fp.chalk).toBeCloseTo(expectedShrunk, 10);
  });

  it('timing raw=2*0.3-1=-0.4, shrunk', () => {
    const fp = computeFingerprint([pick], null, COMPUTED_AT);
    const expectedShrunk = -0.4 * (1 / (1 + SHRINK_K));
    expect(fp.timing).toBeCloseTo(expectedShrunk, 10);
  });

  it('contrarian raw=1 (single eligible minority pick), shrunk', () => {
    const fp = computeFingerprint([pick], null, COMPUTED_AT);
    const expectedShrunk = 1 * (1 / (1 + SHRINK_K));
    expect(fp.contrarian).toBeCloseTo(expectedShrunk, 10);
  });

  it('category_shares = {sports: 1}; category_accuracy omitted (n<5)', () => {
    const fp = computeFingerprint([pick], null, COMPUTED_AT);
    expect(fp.categoryShares).toEqual({ sports: 1 });
    expect(fp.categoryAccuracy).toEqual({});
  });

  it('prior blending: (n*shrunk + PRIOR_WEIGHT*prior)/(n+PRIOR_WEIGHT), per-axis only where prior has it', () => {
    const prior = { chalk: 0.5, contrarian: -0.2 }; // no timing — placement-style prior
    const fp = computeFingerprint([pick], prior, COMPUTED_AT);

    const shrunkChalk = 0.4 * (1 / (1 + SHRINK_K));
    const blendedChalk = (1 * shrunkChalk + PRIOR_WEIGHT * 0.5) / (1 + PRIOR_WEIGHT);
    expect(fp.chalk).toBeCloseTo(blendedChalk, 10);

    const shrunkContrarian = 1 * (1 / (1 + SHRINK_K));
    const blendedContrarian = (1 * shrunkContrarian + PRIOR_WEIGHT * -0.2) / (1 + PRIOR_WEIGHT);
    expect(fp.contrarian).toBeCloseTo(blendedContrarian, 10);

    // timing untouched — prior has no timing axis (placement priors never have one, §8.7)
    const shrunkTiming = -0.4 * (1 / (1 + SHRINK_K));
    expect(fp.timing).toBeCloseTo(shrunkTiming, 10);
  });

  it('priors never affect accuracy/edge/brier (INV-5)', () => {
    const withPrior = computeFingerprint([pick], { chalk: 0.99, contrarian: 0.99, timing: 0.99 }, COMPUTED_AT);
    const withoutPrior = computeFingerprint([pick], null, COMPUTED_AT);
    expect(withPrior.accuracy).toBe(withoutPrior.accuracy);
    expect(withPrior.edgeMean).toBe(withoutPrior.edgeMean);
    expect(withPrior.brier).toBe(withoutPrior.brier);
  });
});

describe('computeFingerprint — CROWD_MIN_N exclusion (§8.1 contrarian)', () => {
  it('excludes picks whose lock-crowd n < CROWD_MIN_N from the contrarian numerator/denominator', () => {
    const belowThreshold = pickAtFraction(0.5, { lockCrowd: { yes: 5, no: 10 } }); // n=15 < 20
    const fp = computeFingerprint([belowThreshold], null, COMPUTED_AT);
    // no eligible crowd picks -> raw contrarian = 0 regardless of the (would-be) minority pick
    expect(fp.contrarian).toBe(0);
  });

  it('boundary: exactly CROWD_MIN_N counts as eligible', () => {
    const yes = Math.floor(CROWD_MIN_N * 0.4);
    const no = CROWD_MIN_N - yes;
    const atThreshold = pickAtFraction(0.5, {
      side: 'yes',
      lockCrowd: { yes, no }, // total = CROWD_MIN_N exactly, chosen(yes) share < 0.5 => minority
    });
    const fp = computeFingerprint([atThreshold], null, COMPUTED_AT);
    const expectedShrunk = 1 * (1 / (1 + SHRINK_K));
    expect(fp.contrarian).toBeCloseTo(expectedShrunk, 10);
  });

  it('mixes eligible and ineligible picks correctly in the same fingerprint', () => {
    const eligibleMinority = pickAtFraction(0.5, { side: 'yes', lockCrowd: { yes: 5, no: 20 } }); // n=25, share 0.2 minority
    const ineligible = pickAtFraction(0.5, { side: 'no', lockCrowd: { yes: 10, no: 5 } }); // n=15 < 20, excluded
    const fp = computeFingerprint([eligibleMinority, ineligible], null, COMPUTED_AT);
    // only 1 eligible pick, and it is a minority pick -> raw = 2*(1/1)-1 = 1
    const expectedShrunk = 1 * (2 / (2 + SHRINK_K)); // n=2 total picks for shrinkage
    expect(fp.contrarian).toBeCloseTo(expectedShrunk, 10);
  });
});

describe('computeFingerprint — shrinkage at n=100 (near-unshrunk)', () => {
  it('n=100 shrink factor = 100/110', () => {
    const picks: GradedPickInput[] = Array.from({ length: 100 }, () =>
      pickAtFraction(1, { side: 'yes', yesPriceAtEntry: 0.9, won: true, lockCrowd: { yes: 0, no: 0 } }),
    );
    const fp = computeFingerprint(picks, null, COMPUTED_AT);
    const chalkRaw = 2 * 0.9 - 1; // 0.8
    const timingRaw = 2 * 1 - 1; // 1.0
    expect(fp.chalk).toBeCloseTo(chalkRaw * (100 / (100 + SHRINK_K)), 10);
    expect(fp.timing).toBeCloseTo(timingRaw * (100 / (100 + SHRINK_K)), 10);
  });
});

describe('computeFingerprint — category accuracy gate (n>=5)', () => {
  it('reports category_accuracy only for categories with n>=5', () => {
    const sportsPicks = Array.from({ length: 5 }, (_, i) =>
      pickAtFraction(0.5, { category: 'sports', won: i < 3, lockCrowd: { yes: 0, no: 0 } }),
    );
    const politicsPicks = Array.from({ length: 4 }, () =>
      pickAtFraction(0.5, { category: 'politics', won: true, lockCrowd: { yes: 0, no: 0 } }),
    );
    const fp = computeFingerprint([...sportsPicks, ...politicsPicks], null, COMPUTED_AT);
    expect(fp.categoryAccuracy.sports).toBeCloseTo(3 / 5, 10);
    expect(fp.categoryAccuracy.politics).toBeUndefined();
    expect(fp.categoryShares.sports).toBeCloseTo(5 / 9, 10);
    expect(fp.categoryShares.politics).toBeCloseTo(4 / 9, 10);
  });
});
