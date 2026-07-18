/**
 * §8.12 weekly leaderboard raw data (WS3-T7). Pure ranking/aggregation is
 * `apps/web/lib/leaderboards.ts` (co-located with its only consumer, unit-testable without a
 * DB); this is just the query — graded-and-revealed picks in the ET week, joined for category +
 * eligibility fields.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';

export interface LeaderboardPickRow {
  profileId: string;
  handle: string;
  slug: string;
  kind: 'ghost' | 'claimed';
  botScore: number;
  category: string;
  result: 'win' | 'loss';
  edge: number;
  pickedAtMs: number;
}

/**
 * Daily, `revealed`, `question_date` in `[weekStart, weekEnd]` (inclusive), win/loss only —
 * "only revealed questions count" (§8.12 publication rule), void/pending excluded.
 *
 * SPEC-GAP(WS3-T7): §8.12 says bonus questions (`nemesis_bonus`/`duo_bonus`) are included by
 * their `lock_at` date, not just `kind = 'daily'` questions by `question_date`. No bonus
 * questions exist yet this wave (WS5/WS6, their originating workstreams, aren't built), so
 * there's nothing to test this against today — but this filter has no marker distinguishing
 * "the doc's bonus-question rule was implemented and found not to apply" from "it was simply
 * never revisited." When WS5/WS6 land, this needs a `(kind = 'daily' AND ...) OR (kind IN
 * ('nemesis_bonus','duo_bonus') AND lock_at::date BETWEEN weekStart AND weekEnd)` branch (or
 * equivalent) — otherwise those results silently never surface on weekly leaderboards.
 */
export async function getLeaderboardPicksForWeek(
  db: Db,
  weekStart: string,
  weekEnd: string,
): Promise<LeaderboardPickRow[]> {
  const rows = await db.execute(sql`
    SELECT p.profile_id, pr.handle, pr.slug, pr.kind, pr.bot_score, m.category,
           p.result, p.edge, extract(epoch from p.picked_at) * 1000 AS picked_at_ms
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    JOIN markets m ON m.id = q.market_id
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE q.kind = 'daily' AND q.status = 'revealed'
      AND q.question_date >= ${weekStart} AND q.question_date <= ${weekEnd}
      AND p.result IN ('win', 'loss')
  `);
  return rows.rows.map((r) => ({
    profileId: r['profile_id'] as string,
    handle: r['handle'] as string,
    slug: r['slug'] as string,
    kind: r['kind'] as 'ghost' | 'claimed',
    botScore: Number(r['bot_score']),
    category: r['category'] as string,
    result: r['result'] as 'win' | 'loss',
    edge: Number(r['edge']),
    pickedAtMs: Number(r['picked_at_ms']),
  }));
}
