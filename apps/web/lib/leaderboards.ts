/**
 * §8.12 weekly leaderboard aggregation + ranking — pure function over already-fetched pick rows
 * (`@receipts/db`'s `getLeaderboardPicksForWeek`), so rank/tiebreak/eligibility logic is
 * unit-testable without a database.
 */
import { BOT_EXCLUDE_THRESHOLD, LEADERBOARD_MIN_PICKS } from '@receipts/core';
import type { LeaderboardPickRow } from '@receipts/db';

export interface LeaderboardRankedEntry {
  rank: number;
  profile: { profile_id: string; handle: string; slug: string };
  wins: number;
  edge_sum: number;
  picks: number;
}

interface Accumulator {
  handle: string;
  slug: string;
  wins: number;
  edgeSum: number;
  picks: number;
  pickedAtMsSum: number;
}

/**
 * Ranks eligible profiles for one board (`category`, or `'overall'` for no category filter):
 * claimed + `bot_score < BOT_EXCLUDE_THRESHOLD` + `>= LEADERBOARD_MIN_PICKS` graded-and-revealed
 * picks in the window (both already true of every row `getLeaderboardPicksForWeek` returns,
 * except the claimed/bot-score/min-picks eligibility gates, applied here). Rank by
 * (wins desc, Σedge desc, earliest mean pick time asc); top 100 (§8.12).
 */
export function rankLeaderboard(rows: readonly LeaderboardPickRow[], category: string | 'overall'): LeaderboardRankedEntry[] {
  const scoped = category === 'overall' ? rows : rows.filter((r) => r.category === category);
  const eligible = scoped.filter((r) => r.kind === 'claimed' && r.botScore < BOT_EXCLUDE_THRESHOLD);

  const byProfile = new Map<string, Accumulator>();
  for (const r of eligible) {
    const acc = byProfile.get(r.profileId) ?? { handle: r.handle, slug: r.slug, wins: 0, edgeSum: 0, picks: 0, pickedAtMsSum: 0 };
    acc.wins += r.result === 'win' ? 1 : 0;
    acc.edgeSum += r.edge;
    acc.picks += 1;
    acc.pickedAtMsSum += r.pickedAtMs;
    byProfile.set(r.profileId, acc);
  }

  const candidates = [...byProfile.entries()]
    .filter(([, acc]) => acc.picks >= LEADERBOARD_MIN_PICKS)
    .map(([profileId, acc]) => ({
      profileId,
      handle: acc.handle,
      slug: acc.slug,
      wins: acc.wins,
      edgeSum: acc.edgeSum,
      picks: acc.picks,
      meanPickedAtMs: acc.pickedAtMsSum / acc.picks,
    }));

  candidates.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.edgeSum !== a.edgeSum) return b.edgeSum - a.edgeSum;
    return a.meanPickedAtMs - b.meanPickedAtMs;
  });

  return candidates.slice(0, 100).map((c, i) => ({
    rank: i + 1,
    profile: { profile_id: c.profileId, handle: c.handle, slug: c.slug },
    wins: c.wins,
    edge_sum: c.edgeSum,
    picks: c.picks,
  }));
}
