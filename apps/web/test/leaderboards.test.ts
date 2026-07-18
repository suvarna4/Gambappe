/**
 * §8.12 weekly leaderboard rank/tiebreak + eligibility gates (WS3-T7 AC). Pure function, no DB.
 */
import { describe, expect, it } from 'vitest';
import type { LeaderboardPickRow } from '@receipts/db';
import { rankLeaderboard } from '@/lib/leaderboards';

function row(overrides: Partial<LeaderboardPickRow> & { profileId: string }): LeaderboardPickRow {
  return {
    handle: `Handle-${overrides.profileId}`,
    slug: `slug-${overrides.profileId}`,
    kind: 'claimed',
    botScore: 0,
    category: 'sports',
    result: 'win',
    edge: 0.4,
    pickedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('rankLeaderboard (§8.12)', () => {
  it('ranks by wins desc, then edge_sum desc, then earliest mean pick time', () => {
    const rows: LeaderboardPickRow[] = [
      // Profile A: 3 picks, 2 wins, edge_sum lower
      row({ profileId: 'a', result: 'win', edge: 0.3, pickedAtMs: 100 }),
      row({ profileId: 'a', result: 'win', edge: 0.2, pickedAtMs: 200 }),
      row({ profileId: 'a', result: 'loss', edge: -0.5, pickedAtMs: 300 }),
      // Profile B: 3 picks, 2 wins, edge_sum higher (should rank above A)
      row({ profileId: 'b', result: 'win', edge: 0.9, pickedAtMs: 100 }),
      row({ profileId: 'b', result: 'win', edge: 0.8, pickedAtMs: 200 }),
      row({ profileId: 'b', result: 'loss', edge: -0.1, pickedAtMs: 300 }),
      // Profile C: 3 picks, 3 wins (should rank first — most wins)
      row({ profileId: 'c', result: 'win', edge: 0.1, pickedAtMs: 500 }),
      row({ profileId: 'c', result: 'win', edge: 0.1, pickedAtMs: 500 }),
      row({ profileId: 'c', result: 'win', edge: 0.1, pickedAtMs: 500 }),
    ];
    const ranked = rankLeaderboard(rows, 'overall');
    expect(ranked.map((e) => e.profile.profile_id)).toEqual(['c', 'b', 'a']);
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[0]!.wins).toBe(3);
  });

  it('breaks a wins+edge tie by earliest mean pick time', () => {
    const rows: LeaderboardPickRow[] = [
      row({ profileId: 'early', result: 'win', edge: 0.5, pickedAtMs: 100 }),
      row({ profileId: 'early', result: 'win', edge: 0.5, pickedAtMs: 100 }),
      row({ profileId: 'early', result: 'win', edge: 0.5, pickedAtMs: 100 }),
      row({ profileId: 'late', result: 'win', edge: 0.5, pickedAtMs: 999 }),
      row({ profileId: 'late', result: 'win', edge: 0.5, pickedAtMs: 999 }),
      row({ profileId: 'late', result: 'win', edge: 0.5, pickedAtMs: 999 }),
    ];
    const ranked = rankLeaderboard(rows, 'overall');
    expect(ranked.map((e) => e.profile.profile_id)).toEqual(['early', 'late']);
  });

  it('excludes ghost profiles (claimed-only eligibility)', () => {
    const rows: LeaderboardPickRow[] = [
      row({ profileId: 'ghost1', kind: 'ghost', result: 'win' }),
      row({ profileId: 'ghost1', kind: 'ghost', result: 'win' }),
      row({ profileId: 'ghost1', kind: 'ghost', result: 'win' }),
    ];
    expect(rankLeaderboard(rows, 'overall')).toEqual([]);
  });

  it('excludes bot-scored profiles (bot_score >= BOT_EXCLUDE_THRESHOLD)', () => {
    const rows: LeaderboardPickRow[] = [
      row({ profileId: 'bot', botScore: 0.9, result: 'win' }),
      row({ profileId: 'bot', botScore: 0.9, result: 'win' }),
      row({ profileId: 'bot', botScore: 0.9, result: 'win' }),
    ];
    expect(rankLeaderboard(rows, 'overall')).toEqual([]);
  });

  it('excludes profiles under LEADERBOARD_MIN_PICKS (3)', () => {
    const rows: LeaderboardPickRow[] = [
      row({ profileId: 'lowvolume', result: 'win' }),
      row({ profileId: 'lowvolume', result: 'win' }),
    ];
    expect(rankLeaderboard(rows, 'overall')).toEqual([]);
  });

  it('scopes to a single category board', () => {
    const rows: LeaderboardPickRow[] = [
      row({ profileId: 'sports-player', category: 'sports', result: 'win' }),
      row({ profileId: 'sports-player', category: 'sports', result: 'win' }),
      row({ profileId: 'sports-player', category: 'sports', result: 'win' }),
      row({ profileId: 'politics-player', category: 'politics', result: 'win' }),
      row({ profileId: 'politics-player', category: 'politics', result: 'win' }),
      row({ profileId: 'politics-player', category: 'politics', result: 'win' }),
    ];
    const sportsBoard = rankLeaderboard(rows, 'sports');
    expect(sportsBoard.map((e) => e.profile.profile_id)).toEqual(['sports-player']);
  });

  it('caps at top 100', () => {
    const rows: LeaderboardPickRow[] = [];
    for (let i = 0; i < 150; i++) {
      const id = `p${i}`;
      rows.push(row({ profileId: id, result: 'win', edge: i, pickedAtMs: i }));
      rows.push(row({ profileId: id, result: 'win', edge: i, pickedAtMs: i }));
      rows.push(row({ profileId: id, result: 'win', edge: i, pickedAtMs: i }));
    }
    const ranked = rankLeaderboard(rows, 'overall');
    expect(ranked).toHaveLength(100);
    expect(ranked[0]!.profile.profile_id).toBe('p149'); // highest edge_sum ranks first
  });
});
