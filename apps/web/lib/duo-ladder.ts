/**
 * `GET /api/v1/duo/ladder` (design doc §8.10 ladder, §9.2 "tier standings, paginated", WS6-T4).
 *
 * Ranking/pagination is a pure function over already-fetched standings
 * (`@receipts/db`'s `listCurrentDuoLadderStandings`) — mirrors `leaderboards.ts`'s
 * "rank as a pure, DB-free function" split so the sort/tiebreak/cursor-slice logic is
 * unit-testable without Postgres. "MVP scale: single global ladder" (§8.10) means the whole
 * standings set is cheap to load and rank in memory each request — no snapshot table, matching
 * §8.12's "computed on demand" leaderboard precedent one mechanic over.
 */
import type { z } from 'zod';
import { etDateString, PAGINATION_MAX_LIMIT, type getLadderResponseSchema } from '@receipts/core';
import {
  getDuoById,
  listCurrentDuoLadderStandings,
  type Db,
  type DuoSeasonStanding,
} from '@receipts/db';
import { toDuoPublic } from './serialize-duo';

/**
 * SPEC-GAP(ws6-t4): Appendix D pins no specific default page size for the ladder — §9.1 only
 * caps the max at `PAGINATION_MAX_LIMIT` (50). Mirrors `profile-page.ts`'s
 * `PROFILE_PICKS_DEFAULT_LIMIT` precedent for the same class of gap.
 */
export const DUO_LADDER_DEFAULT_LIMIT = 20;

export interface RankedDuoStanding extends DuoSeasonStanding {
  rank: number;
}

/**
 * Sorts standings (tier asc, wins desc, rating desc, duoId asc as a deterministic final
 * tiebreak) and assigns a 1-based global `rank` over the FULL sorted set — i.e. rank reflects
 * true standing, not a page-relative position. `tierFilter`, when given, narrows the input
 * first; rank is then computed over just that tier (so a tier-2 view starts back at rank 1,
 * matching what a "Tier 2 standings" reading of the endpoint would expect).
 */
export function rankDuoStandings(standings: readonly DuoSeasonStanding[], tierFilter?: number): RankedDuoStanding[] {
  const scoped = tierFilter === undefined ? standings : standings.filter((s) => s.tier === tierFilter);
  const sorted = [...scoped].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.duoId < b.duoId ? -1 : a.duoId > b.duoId ? 1 : 0;
  });
  return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
}

/** Opaque cursor = the offset into the ranked array to resume from (base64url of the decimal
 * string) — a deliberately simple offset cursor rather than a keyset one: the whole ranked set
 * is recomputed fresh every request (no stored ordering to key against), same "computed on
 * demand" territory as `leaderboards.ts`. §9.1 only requires cursor pagination be OPAQUE to the
 * client, not any particular encoding scheme. */
export function encodeLadderCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function decodeLadderCursor(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const n = Number(Buffer.from(raw, 'base64url').toString('utf8'));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export interface PaginatedRankedStandings {
  page: RankedDuoStanding[];
  nextCursor: string | null;
}

export function paginateRankedStandings(
  ranked: readonly RankedDuoStanding[],
  cursor: string | null | undefined,
  limit: number,
): PaginatedRankedStandings {
  const offset = decodeLadderCursor(cursor);
  const page = ranked.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < ranked.length ? encodeLadderCursor(nextOffset) : null;
  return { page, nextCursor };
}

export interface DuoLadderQuery {
  tier?: number;
  cursor?: string;
  limit?: number;
}

/**
 * Full `GET /duo/ladder` response assembly: load standings for the season covering `at`, rank +
 * paginate them (pure logic above), then hydrate the page's duo ids into full
 * `duoPublicSchema` entries (reusing `serialize-duo.ts`'s `toDuoPublic` — bounded to at most
 * `PAGINATION_MAX_LIMIT` (50) extra duo+profile lookups per page, acceptable at the documented
 * "MVP scale: single global ladder", §8.10).
 */
export async function getDuoLadderPage(
  db: Db,
  query: DuoLadderQuery,
  at: Date,
): Promise<z.infer<typeof getLadderResponseSchema>> {
  const limit = Math.min(query.limit ?? DUO_LADDER_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT);
  const standings = await listCurrentDuoLadderStandings(db, etDateString(at));
  const ranked = rankDuoStandings(standings, query.tier);
  const { page, nextCursor } = paginateRankedStandings(ranked, query.cursor, limit);

  const data = await Promise.all(
    page.map(async (entry) => {
      const duo = await getDuoById(db, entry.duoId);
      if (!duo) throw new Error(`getDuoLadderPage: duo ${entry.duoId} vanished mid-request`);
      return {
        rank: entry.rank,
        tier: entry.tier,
        duo: await toDuoPublic(db, duo),
        wins: entry.wins,
      };
    }),
  );

  return { data, meta: { next_cursor: nextCursor } };
}
