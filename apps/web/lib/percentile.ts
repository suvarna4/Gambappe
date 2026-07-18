/**
 * §8.6 viewer percentile for the reveal payload: Redis (`reveal:{questionId}` hash) is a cache,
 * not the source — on a miss, recompute from Postgres and re-populate. Shares the same pure
 * formula + DB read `apps/worker/src/jobs/percentiles.ts` uses to WRITE the cache
 * (`computePercentiles` + `getGradedPickScoresForQuestion`); only the thin Redis glue differs
 * per runtime (no cross-app import between `apps/web`/`apps/worker`).
 */
import type { Redis } from 'ioredis';
import { computePercentiles } from '@receipts/core';
import { getGradedPickScoresForQuestion, type Db } from '@receipts/db';

const REVEAL_HASH_TTL_S = 7 * 24 * 3600;

function revealHashKey(questionId: string): string {
  return `reveal:${questionId}`;
}

async function recomputeAndCache(db: Db, redis: Redis, questionId: string): Promise<Map<string, number>> {
  const entries = await getGradedPickScoresForQuestion(db, questionId);
  const byProfile = new Map<string, number>();
  if (entries.length === 0) return byProfile;

  const percentiles = computePercentiles(entries.map((e) => e.edge));
  const fields: Record<string, string> = {};
  entries.forEach((e, i) => {
    fields[e.profileId] = String(percentiles[i]);
    byProfile.set(e.profileId, percentiles[i]!);
  });
  await redis.hset(revealHashKey(questionId), fields);
  await redis.expire(revealHashKey(questionId), REVEAL_HASH_TTL_S);
  return byProfile;
}

/** `null` when the profile has no bot-excluded graded pick on this question (e.g. bot-scored,
 * or didn't pick / picked but ungraded — callers only call this once a pick is known graded). */
export async function getViewerPercentile(
  db: Db,
  redis: Redis,
  questionId: string,
  profileId: string,
): Promise<number | null> {
  const cached = await redis.hget(revealHashKey(questionId), profileId);
  if (cached !== null) return Number(cached);

  const recomputed = await recomputeAndCache(db, redis, questionId);
  return recomputed.get(profileId) ?? null;
}
