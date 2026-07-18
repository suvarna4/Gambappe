/**
 * WS6-T3 AC: 20/20% boundary tests (§8.10 promotion/relegation).
 */
import { describe, expect, it } from 'vitest';
import { LADDER_PROMOTE_PCT, LADDER_RELEGATE_PCT, LADDER_TIERS } from '@receipts/core';
import { computeLadderMovements } from '../src/duo-ladder.js';
import type { DuoLadderStanding } from '../src/duo-ladder.js';

function standing(overrides: Partial<DuoLadderStanding> & { duoId: string }): DuoLadderStanding {
  return {
    tier: 2,
    rating: 1500,
    wins: 0,
    ...overrides,
  };
}

describe('computeLadderMovements — sanity on the tuned constants', () => {
  it('LADDER_PROMOTE_PCT and LADDER_RELEGATE_PCT are both 20% (Appendix D)', () => {
    expect(LADDER_PROMOTE_PCT).toBe(0.2);
    expect(LADDER_RELEGATE_PCT).toBe(0.2);
  });
});

describe('computeLadderMovements — 20/20% boundary math', () => {
  it('a tier of exactly 5 (clean 20%) promotes the top 1 and relegates the bottom 1', () => {
    const standings: DuoLadderStanding[] = [
      standing({ duoId: 'd1', wins: 5, rating: 1600 }), // rank 1 -> promoted
      standing({ duoId: 'd2', wins: 4, rating: 1500 }),
      standing({ duoId: 'd3', wins: 3, rating: 1500 }),
      standing({ duoId: 'd4', wins: 2, rating: 1500 }),
      standing({ duoId: 'd5', wins: 1, rating: 1400 }), // rank 5 -> relegated
    ];
    const movements = computeLadderMovements(standings);
    expect(movements).toHaveLength(2);
    expect(movements).toContainEqual({ duoId: 'd1', fromTier: 2, toTier: 3, direction: 'promoted' });
    expect(movements).toContainEqual({ duoId: 'd5', fromTier: 2, toTier: 1, direction: 'relegated' });
  });

  it('a tier of 4 (0.8 promoted/relegated, floors to 0) moves nobody', () => {
    const standings: DuoLadderStanding[] = [
      standing({ duoId: 'd1', wins: 9 }),
      standing({ duoId: 'd2', wins: 3 }),
      standing({ duoId: 'd3', wins: 2 }),
      standing({ duoId: 'd4', wins: 0 }),
    ];
    expect(computeLadderMovements(standings)).toEqual([]);
  });

  it('a tier of 10 (clean 20%) promotes the top 2 and relegates the bottom 2', () => {
    const standings: DuoLadderStanding[] = Array.from({ length: 10 }, (_, i) =>
      standing({ duoId: `d${i}`, wins: 10 - i, rating: 1500 }),
    );
    const movements = computeLadderMovements(standings);
    const promoted = movements.filter((m) => m.direction === 'promoted').map((m) => m.duoId).sort();
    const relegated = movements.filter((m) => m.direction === 'relegated').map((m) => m.duoId).sort();
    expect(promoted).toEqual(['d0', 'd1']); // top 2 by wins
    expect(relegated).toEqual(['d8', 'd9']); // bottom 2 by wins
  });

  it('a tier of 1 never moves (nothing to rank against)', () => {
    expect(computeLadderMovements([standing({ duoId: 'lonely', wins: 100 })])).toEqual([]);
  });

  it('ties break on rating, then on duoId ascending, deterministically', () => {
    const standings: DuoLadderStanding[] = [
      standing({ duoId: 'z', wins: 3, rating: 1500 }),
      standing({ duoId: 'a', wins: 3, rating: 1500 }), // ties z on both wins and rating -> 'a' wins the tie-break
      standing({ duoId: 'm', wins: 3, rating: 1400 }),
      standing({ duoId: 'b', wins: 1, rating: 1500 }),
      standing({ duoId: 'c', wins: 0, rating: 1500 }),
    ];
    const movements = computeLadderMovements(standings);
    const promoted = movements.filter((m) => m.direction === 'promoted');
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.duoId).toBe('a'); // beats 'z' on the duoId tie-break
  });

  it('promotion is a no-op (clamped, no movement) for a duo already at LADDER_TIERS', () => {
    const standings: DuoLadderStanding[] = [
      standing({ duoId: 'top1', tier: LADDER_TIERS, wins: 5 }),
      standing({ duoId: 'top2', tier: LADDER_TIERS, wins: 4 }),
      standing({ duoId: 'top3', tier: LADDER_TIERS, wins: 3 }),
      standing({ duoId: 'top4', tier: LADDER_TIERS, wins: 2 }),
      standing({ duoId: 'top5', tier: LADDER_TIERS, wins: 1 }),
    ];
    const movements = computeLadderMovements(standings);
    // Bottom 1 (top5) still relegates down to LADDER_TIERS - 1; top 1 (top1) has nowhere to
    // promote to and produces no movement at all.
    expect(movements).toHaveLength(1);
    expect(movements[0]).toEqual({ duoId: 'top5', fromTier: LADDER_TIERS, toTier: LADDER_TIERS - 1, direction: 'relegated' });
  });

  it('relegation is a no-op (clamped, no movement) for a duo already at tier 1', () => {
    const standings: DuoLadderStanding[] = [
      standing({ duoId: 'bot1', tier: 1, wins: 5 }),
      standing({ duoId: 'bot2', tier: 1, wins: 4 }),
      standing({ duoId: 'bot3', tier: 1, wins: 3 }),
      standing({ duoId: 'bot4', tier: 1, wins: 2 }),
      standing({ duoId: 'bot5', tier: 1, wins: 1 }),
    ];
    const movements = computeLadderMovements(standings);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toEqual({ duoId: 'bot1', fromTier: 1, toTier: 2, direction: 'promoted' });
  });

  it('multiple tiers are ranked independently', () => {
    const standings: DuoLadderStanding[] = [
      // Tier 1 (floor): top 1 promotes to tier 2; bottom 1 has nowhere lower, so it's a no-op.
      standing({ duoId: 't1-a', tier: 1, wins: 5 }),
      standing({ duoId: 't1-b', tier: 1, wins: 4 }),
      standing({ duoId: 't1-c', tier: 1, wins: 3 }),
      standing({ duoId: 't1-d', tier: 1, wins: 2 }),
      standing({ duoId: 't1-e', tier: 1, wins: 1 }),
      // Tier 3 (mid-ladder): both promotion and relegation apply normally.
      standing({ duoId: 't3-a', tier: 3, wins: 9 }),
      standing({ duoId: 't3-b', tier: 3, wins: 8 }),
      standing({ duoId: 't3-c', tier: 3, wins: 7 }),
      standing({ duoId: 't3-d', tier: 3, wins: 6 }),
      standing({ duoId: 't3-e', tier: 3, wins: 5 }),
    ];
    const movements = computeLadderMovements(standings);
    expect(movements).toHaveLength(3);
    expect(movements).toContainEqual({ duoId: 't1-a', fromTier: 1, toTier: 2, direction: 'promoted' });
    expect(movements).toContainEqual({ duoId: 't3-a', fromTier: 3, toTier: 4, direction: 'promoted' });
    expect(movements).toContainEqual({ duoId: 't3-e', fromTier: 3, toTier: 2, direction: 'relegated' });
  });
});
