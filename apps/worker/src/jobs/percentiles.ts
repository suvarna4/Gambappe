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

/** Computes and writes the full `reveal:{questionId}` percentile hash. An empty graded set
 * DELETES any existing hash rather than leaving it (a re-run after a set-shrinking event —
 * regrade voiding every pick, bot re-score — must not keep serving stale members). */
export async function computeAndCachePercentiles(db: Db, redis: Redis, questionId: string): Promise<void> {
  const key = revealHashKey(questionId);
  const entries = await getGradedPickScoresForQuestion(db, questionId);
  if (entries.length === 0) {
    await redis.del(key);
    return;
  }

  const percentiles = computePercentiles(entries.map((e) => e.edge));
  const fields: Record<string, string> = {};
  entries.forEach((e, i) => {
    fields[e.profileId] = String(percentiles[i]);
  });

  // DEL + HSET + EXPIRE in one MULTI, mirroring `apps/web/lib/percentile.ts`'s
  // `recomputeAndCache` (same rationale, deliberately duplicated per the no-cross-app-import
  // rule): the hash is a full SNAPSHOT of the current graded set — a bare hset would merge over
  // a previous write and resurrect members a regrade/bot re-score removed — and it can never be
  // committed without its TTL. Per-command errors from exec() are surfaced, not swallowed.
  const execResults = await redis.multi().del(key).hset(key, fields).expire(key, REVEAL_HASH_TTL_S).exec();
  if (!execResults) throw new Error('computeAndCachePercentiles: MULTI discarded');
  const execError = execResults.find(([err]) => err !== null)?.[0];
  if (execError) throw execError;
}
