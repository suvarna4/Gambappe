/**
 * §8.6 daily percentile: compute + cache into Redis (`reveal:{questionId}` hash, TTL 7 days).
 * Called from `grade:followup` (WS3-T5). The reveal API (apps/web) recomputes on cache miss
 * using the same two pieces this composes (`getGradedPickScoresForQuestion` +
 * `computePercentiles`) — see `apps/web/lib/percentile.ts` — "Redis is a cache, not the
 * source" (§8.6): the two call sites intentionally share the pure/DB layers, not the Redis glue.
 */
import type { Redis } from 'ioredis';
import { computePercentiles } from '@receipts/core';
import { getGradedPickScoresForQuestion, type Db } from '@receipts/db';

const REVEAL_HASH_TTL_S = 7 * 24 * 3600;

export function revealHashKey(questionId: string): string {
  return `reveal:${questionId}`;
}

/** Computes and writes the full `reveal:{questionId}` percentile hash. No-op (hash left absent)
 * when there are no bot-excluded graded picks to score. */
export async function computeAndCachePercentiles(db: Db, redis: Redis, questionId: string): Promise<void> {
  const entries = await getGradedPickScoresForQuestion(db, questionId);
  if (entries.length === 0) return;

  const percentiles = computePercentiles(entries.map((e) => e.edge));
  const fields: Record<string, string> = {};
  entries.forEach((e, i) => {
    fields[e.profileId] = String(percentiles[i]);
  });

  await redis.hset(revealHashKey(questionId), fields);
  await redis.expire(revealHashKey(questionId), REVEAL_HASH_TTL_S);
}
