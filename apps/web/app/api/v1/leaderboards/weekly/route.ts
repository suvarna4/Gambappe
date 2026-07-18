/**
 * `GET /api/v1/leaderboards/weekly` (design doc §8.12, §9.2, WS3-T7). Computed on demand from
 * `picks`, 300s Redis cache keyed by `week_start` (raw picks rows, not the ranked boards — so a
 * `category` query narrows the response without invalidating/duplicating the cache). The
 * in-progress week is served too, labeled `live`.
 */
import type { NextResponse } from 'next/server';
import { MARKET_CATEGORY, addDaysToDateString, etDateString, getWeeklyLeaderboardsRequestSchema, isoWeekMonday, now } from '@receipts/core';
import { getLeaderboardPicksForWeek, type LeaderboardPickRow } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { rankLeaderboard } from '@/lib/leaderboards';
import { getDb, getRedis } from '@/lib/stores';

export const runtime = 'nodejs';

const CACHE_TTL_S = 300;

function cacheKey(weekStart: string): string {
  return `leaderboard:${weekStart}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const url = new URL(request.url);
    const parsed = getWeeklyLeaderboardsRequestSchema.parse({
      query: {
        week_start: url.searchParams.get('week_start') ?? undefined,
        category: url.searchParams.get('category') ?? undefined,
      },
    });

    const at = now();
    const todayEt = etDateString(at);
    const weekStart = parsed.query.week_start ?? isoWeekMonday(todayEt);
    const weekEnd = addDaysToDateString(weekStart, 6);
    const live = todayEt >= weekStart && todayEt <= weekEnd;

    const redis = getRedis();
    const key = cacheKey(weekStart);
    const cached = await redis.get(key);
    let rows: LeaderboardPickRow[];
    if (cached !== null) {
      rows = JSON.parse(cached) as LeaderboardPickRow[];
    } else {
      rows = await getLeaderboardPicksForWeek(getDb(), weekStart, weekEnd);
      await redis.set(key, JSON.stringify(rows), 'EX', CACHE_TTL_S);
    }

    const categories = parsed.query.category ? [parsed.query.category] : [...MARKET_CATEGORY, 'overall' as const];
    const boards = categories.map((category) => ({ category, entries: rankLeaderboard(rows, category) }));

    return jsonSuccess({ week_start: weekStart, live, boards });
  });
}
