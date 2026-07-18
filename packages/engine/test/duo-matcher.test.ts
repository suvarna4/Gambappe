/**
 * WS4-T5 AC: band widening by wait time; prior-partner exclusion; odd-duo-out priority.
 */
import { describe, expect, it } from 'vitest';
import { DUO_BAND_BASE, DUO_BAND_CAP, DUO_BAND_WIDEN } from '@receipts/core';
import { duoRatingBand, matchDuoPartner, matchDuoVsDuo } from '../src/duo-matcher.js';
import type { DuoQueueCandidate, DuoTeam, DuoWaitingEntry } from '../src/duo-matcher.js';

function candidate(overrides: Partial<DuoQueueCandidate> & { profileId: string }): DuoQueueCandidate {
  return {
    rating: 1500,
    chalk: 0,
    categoryShares: { sports: 1 },
    excludedPartnerIds: new Set(),
    ...overrides,
  };
}

describe('duoRatingBand', () => {
  it('at wait_s=0 the band equals DUO_BAND_BASE', () => {
    expect(duoRatingBand(0)).toBe(DUO_BAND_BASE);
  });

  it('widens by DUO_BAND_WIDEN per full 30s elapsed', () => {
    expect(duoRatingBand(29)).toBe(DUO_BAND_BASE);
    expect(duoRatingBand(30)).toBe(DUO_BAND_BASE + DUO_BAND_WIDEN);
    expect(duoRatingBand(90)).toBe(DUO_BAND_BASE + DUO_BAND_WIDEN * 3);
  });

  it('is capped at DUO_BAND_CAP', () => {
    expect(duoRatingBand(100000)).toBe(DUO_BAND_CAP);
    expect(duoRatingBand(100000)).toBeLessThanOrEqual(DUO_BAND_CAP);
  });
});

describe('matchDuoPartner', () => {
  it('picks the candidate with the best complementarity among in-band candidates', () => {
    const waiting: DuoWaitingEntry = { ...candidate({ profileId: 'w', rating: 1500, chalk: 0.8, categoryShares: { sports: 1 } }), waitSeconds: 0 };
    const candidates: DuoQueueCandidate[] = [
      candidate({ profileId: 'low-complement', rating: 1500, chalk: 0.8, categoryShares: { sports: 1 } }), // identical style
      candidate({ profileId: 'high-complement', rating: 1500, chalk: -0.8, categoryShares: { politics: 1 } }), // opposite style
    ];
    const match = matchDuoPartner(waiting, candidates);
    expect(match?.partnerId).toBe('high-complement');
  });

  it('excludes candidates outside the rating band for the current wait time', () => {
    const waiting: DuoWaitingEntry = { ...candidate({ profileId: 'w', rating: 1500 }), waitSeconds: 0 };
    const candidates: DuoQueueCandidate[] = [candidate({ profileId: 'far', rating: 1500 + DUO_BAND_BASE + 1 })];
    expect(matchDuoPartner(waiting, candidates)).toBeNull();
  });

  it('band widening by wait time brings a previously out-of-band candidate into range', () => {
    const outOfBandDelta = DUO_BAND_BASE + DUO_BAND_WIDEN * 2 - 5; // needs ~2 ticks of widening
    const candidates: DuoQueueCandidate[] = [candidate({ profileId: 'c', rating: 1500 + outOfBandDelta })];

    const stillWaiting: DuoWaitingEntry = { ...candidate({ profileId: 'w', rating: 1500 }), waitSeconds: 0 };
    expect(matchDuoPartner(stillWaiting, candidates)).toBeNull();

    const longWaiting: DuoWaitingEntry = { ...candidate({ profileId: 'w', rating: 1500 }), waitSeconds: 90 };
    expect(matchDuoPartner(longWaiting, candidates)?.partnerId).toBe('c');
  });

  it('excludes blocked/prior partners via the precomputed excludedPartnerIds set (either direction)', () => {
    const candidates: DuoQueueCandidate[] = [candidate({ profileId: 'blocked', rating: 1500 })];

    const waitingExcludesCandidate: DuoWaitingEntry = {
      ...candidate({ profileId: 'w', rating: 1500, excludedPartnerIds: new Set(['blocked']) }),
      waitSeconds: 0,
    };
    expect(matchDuoPartner(waitingExcludesCandidate, candidates)).toBeNull();

    const candidateExcludesWaiting: DuoQueueCandidate[] = [
      candidate({ profileId: 'blocked', rating: 1500, excludedPartnerIds: new Set(['w']) }),
    ];
    const waiting: DuoWaitingEntry = { ...candidate({ profileId: 'w', rating: 1500 }), waitSeconds: 0 };
    expect(matchDuoPartner(waiting, candidateExcludesWaiting)).toBeNull();
  });

  it('returns null when no candidates are eligible', () => {
    const waiting: DuoWaitingEntry = { ...candidate({ profileId: 'w' }), waitSeconds: 0 };
    expect(matchDuoPartner(waiting, [])).toBeNull();
  });
});

describe('matchDuoVsDuo', () => {
  it('pairs by closest team rating within a tier (greedy on sorted list)', () => {
    const duos: DuoTeam[] = [
      { duoId: 'a', rating: 1000, tier: 1 },
      { duoId: 'b', rating: 1050, tier: 1 },
      { duoId: 'c', rating: 1400, tier: 1 },
      { duoId: 'd', rating: 1420, tier: 1 },
    ];
    const result = matchDuoVsDuo(duos);
    expect(result.oddOneOut).toEqual([]);
    const pairKeys = result.pairings.map((p) => [p.duoAId, p.duoBId].sort().join('|')).sort();
    expect(pairKeys).toEqual(['a|b', 'c|d']);
  });

  it('flags the odd duo out in an odd-sized tier with priority-next semantics', () => {
    const duos: DuoTeam[] = [
      { duoId: 'a', rating: 1000, tier: 1 },
      { duoId: 'b', rating: 1050, tier: 1 },
      { duoId: 'c', rating: 1900, tier: 1 }, // highest rated -> sits out
    ];
    const result = matchDuoVsDuo(duos);
    expect(result.pairings).toHaveLength(1);
    expect(result.oddOneOut).toEqual(['c']);
  });

  it('tiers are matched independently', () => {
    const duos: DuoTeam[] = [
      { duoId: 't1-a', rating: 1000, tier: 1 },
      { duoId: 't1-b', rating: 1010, tier: 1 },
      { duoId: 't1-c', rating: 1900, tier: 1 },
      { duoId: 't2-a', rating: 500, tier: 2 },
      { duoId: 't2-b', rating: 520, tier: 2 },
    ];
    const result = matchDuoVsDuo(duos);
    expect(result.pairings).toHaveLength(2);
    expect(result.oddOneOut).toEqual(['t1-c']);
    const involvesTier2 = result.pairings.some(
      (p) => p.duoAId.startsWith('t2') && p.duoBId.startsWith('t2'),
    );
    expect(involvesTier2).toBe(true);
  });
});
