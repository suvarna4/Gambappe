/**
 * `GET /api/v1/duo/ladder` (§8.10, §9.2, WS6-T4) rank/tiebreak/cursor-pagination — pure
 * functions, no DB (mirrors `leaderboards.test.ts`'s split of ranking logic from data fetch).
 */
import { describe, expect, it } from 'vitest';
import type { DuoSeasonStanding } from '@receipts/db';
import {
  decodeLadderCursor,
  encodeLadderCursor,
  paginateRankedStandings,
  rankDuoStandings,
} from '@/lib/duo-ladder';

function standing(overrides: Partial<DuoSeasonStanding> & { duoId: string }): DuoSeasonStanding {
  return { tier: 1, rating: 1500, wins: 0, ...overrides };
}

describe('rankDuoStandings (§8.10)', () => {
  it('ranks by tier asc, then wins desc, then rating desc', () => {
    const standings: DuoSeasonStanding[] = [
      standing({ duoId: 'tier2-a', tier: 2, wins: 5, rating: 1600 }),
      standing({ duoId: 'tier1-lowwin-highrating', tier: 1, wins: 1, rating: 1700 }),
      standing({ duoId: 'tier1-highwin', tier: 1, wins: 3, rating: 1500 }),
      standing({ duoId: 'tier1-tiewin-higherrating', tier: 1, wins: 3, rating: 1550 }),
    ];
    const ranked = rankDuoStandings(standings);
    expect(ranked.map((r) => r.duoId)).toEqual([
      'tier1-tiewin-higherrating', // tier 1, 3 wins, 1550 rating
      'tier1-highwin', // tier 1, 3 wins, 1500 rating
      'tier1-lowwin-highrating', // tier 1, 1 win
      'tier2-a', // tier 2
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks a full tier/wins/rating tie deterministically by duoId', () => {
    const standings: DuoSeasonStanding[] = [
      standing({ duoId: 'zzz', wins: 2, rating: 1500 }),
      standing({ duoId: 'aaa', wins: 2, rating: 1500 }),
    ];
    const ranked = rankDuoStandings(standings);
    expect(ranked.map((r) => r.duoId)).toEqual(['aaa', 'zzz']);
  });

  it('filters to a single tier and restarts rank at 1 within it', () => {
    const standings: DuoSeasonStanding[] = [
      standing({ duoId: 'tier1-a', tier: 1, wins: 10 }),
      standing({ duoId: 'tier2-a', tier: 2, wins: 1 }),
      standing({ duoId: 'tier2-b', tier: 2, wins: 5 }),
    ];
    const ranked = rankDuoStandings(standings, 2);
    expect(ranked.map((r) => r.duoId)).toEqual(['tier2-b', 'tier2-a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('returns an empty array when the tier filter matches nothing', () => {
    const standings: DuoSeasonStanding[] = [standing({ duoId: 'a', tier: 1 })];
    expect(rankDuoStandings(standings, 5)).toEqual([]);
  });
});

describe('ladder cursor codec', () => {
  it('round-trips an offset', () => {
    const encoded = encodeLadderCursor(37);
    expect(decodeLadderCursor(encoded)).toBe(37);
  });

  it('treats a missing/malformed cursor as offset 0', () => {
    expect(decodeLadderCursor(undefined)).toBe(0);
    expect(decodeLadderCursor(null)).toBe(0);
    expect(decodeLadderCursor('not-valid-base64url-garbage!!!')).toBe(0);
  });

  it('never returns a negative offset for a tampered cursor', () => {
    const negative = Buffer.from('-5', 'utf8').toString('base64url');
    expect(decodeLadderCursor(negative)).toBe(0);
  });
});

describe('paginateRankedStandings', () => {
  const ranked = rankDuoStandings(
    Array.from({ length: 5 }, (_, i) => standing({ duoId: `d${i}`, wins: 5 - i })),
  );

  it('returns the first page and a next_cursor when more remain', () => {
    const { page, nextCursor } = paginateRankedStandings(ranked, undefined, 2);
    expect(page.map((p) => p.duoId)).toEqual(['d0', 'd1']);
    expect(nextCursor).not.toBeNull();
  });

  it('resumes from the cursor for the next page', () => {
    const first = paginateRankedStandings(ranked, undefined, 2);
    const second = paginateRankedStandings(ranked, first.nextCursor, 2);
    expect(second.page.map((p) => p.duoId)).toEqual(['d2', 'd3']);
    expect(second.nextCursor).not.toBeNull();
  });

  it('returns a null next_cursor on the last page', () => {
    const first = paginateRankedStandings(ranked, undefined, 2);
    const second = paginateRankedStandings(ranked, first.nextCursor, 2);
    const third = paginateRankedStandings(ranked, second.nextCursor, 2);
    expect(third.page.map((p) => p.duoId)).toEqual(['d4']);
    expect(third.nextCursor).toBeNull();
  });

  it('an out-of-range cursor yields an empty page, not an error', () => {
    const { page, nextCursor } = paginateRankedStandings(ranked, encodeLadderCursor(999), 2);
    expect(page).toEqual([]);
    expect(nextCursor).toBeNull();
  });
});
