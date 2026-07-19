/**
 * §8.6 viewer percentile for the reveal payload: Redis (`reveal:{questionId}` hash) is a cache,
 * not the source — on a miss, recompute from Postgres and re-populate. Shares the same pure
 * formula + DB read `apps/worker/src/jobs/percentiles.ts` uses to WRITE the cache
 * (`computePercentiles` + `getGradedPickScoresForQuestion`); only the thin Redis glue differs
 * per runtime (no cross-app import between `apps/web`/`apps/worker`).
 */
import type { Redis } from 'ioredis';
import { computePercentiles } from '@receipts/core';
import { getAllGradedPickScoresForQuestion, getGradedPickScoresForQuestion, type Db } from '@receipts/db';
import { ensureRedisConnected } from './stores';

const REVEAL_HASH_TTL_S = 7 * 24 * 3600;

/** Exported for WS10-T3's regrade path (to invalidate a stale cache entry on a failed
 * recompute — see `settlement-admin.ts`). */
export function revealHashKey(questionId: string): string {
  return `reveal:${questionId}`;
}

/** Exported for WS10-T3's regrade path — a regrade changes picks' `edge`, which invalidates the
 * cached percentile hash; this is the same recompute-and-repopulate `getViewerPercentile` uses
 * on a cache miss, just triggered explicitly instead of lazily. */
export async function recomputeAndCache(db: Db, redis: Redis, questionId: string): Promise<Map<string, number>> {
  await ensureRedisConnected(redis);
  const entries = await getGradedPickScoresForQuestion(db, questionId);
  const byProfile = new Map<string, number>();
  if (entries.length === 0) return byProfile;

  const percentiles = computePercentiles(entries.map((e) => e.edge));
  const fields: Record<string, string> = {};
  entries.forEach((e, i) => {
    fields[e.profileId] = String(percentiles[i]);
    byProfile.set(e.profileId, percentiles[i]!);
  });
  // MULTI so the hash can never be committed without its TTL (a crash between a separate
  // hset and expire would otherwise leave an immortal hash).
  await redis.multi().hset(revealHashKey(questionId), fields).expire(revealHashKey(questionId), REVEAL_HASH_TTL_S).exec();
  return byProfile;
}

/** Stampede guard for the cache-miss path below: only one concurrent request per question runs
 * the recompute-and-populate; the rest briefly poll the cache and then, as a bounded fallback,
 * compute for themselves WITHOUT writing (correct answer, no write storm). */
const RECOMPUTE_LOCK_TTL_S = 10;
const RECOMPUTE_POLL_ATTEMPTS = 5;
const RECOMPUTE_POLL_INTERVAL_MS = 100;

function recomputeLockKey(questionId: string): string {
  return `reveal:${questionId}:recompute-lock`;
}

/** `null` only when the profile truly has no graded pick on this question (callers only call
 * this once a pick is known graded, so this is effectively unreachable in practice). A
 * bot-excluded profile still gets a percentile — §8.6: "excluded profiles get their own
 * percentile against the full set" — just never cached in the shared (excluded-set) hash that
 * every other viewer's lookup reads. */
export async function getViewerPercentile(
  db: Db,
  redis: Redis,
  questionId: string,
  profileId: string,
): Promise<number | null> {
  await ensureRedisConnected(redis);
  const cached = await redis.hget(revealHashKey(questionId), profileId);
  if (cached !== null) return Number(cached);

  // Cache miss (worker lag at reveal minute — the reveal-spike worst case). Single-flight the
  // shared recompute: the SET NX winner populates the cache for everyone; losers poll it
  // briefly, then fall back to a private no-write compute rather than piling N identical
  // recompute+hset storms onto the pool.
  let recomputed: Map<string, number> | null = null;
  const lockKey = recomputeLockKey(questionId);
  const lockAcquired = (await redis.set(lockKey, '1', 'EX', RECOMPUTE_LOCK_TTL_S, 'NX')) === 'OK';
  if (lockAcquired) {
    try {
      recomputed = await recomputeAndCache(db, redis, questionId);
    } finally {
      await redis.del(lockKey).catch(() => {});
    }
  } else {
    for (let attempt = 0; attempt < RECOMPUTE_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, RECOMPUTE_POLL_INTERVAL_MS));
      const polled = await redis.hget(revealHashKey(questionId), profileId);
      if (polled !== null) return Number(polled);
    }
  }

  if (recomputed) {
    const percentile = recomputed.get(profileId);
    if (percentile !== undefined) return percentile;
  } else {
    // Poll budget exhausted without the lock holder finishing. Compute privately (no cache
    // write) against the same excluded-set denominator the cache would have held (§8.6) —
    // a non-excluded viewer must never be ranked against the full set just because they
    // arrived during someone else's recompute.
    const entries = await getGradedPickScoresForQuestion(db, questionId);
    const idxExcludedSet = entries.findIndex((e) => e.profileId === profileId);
    if (idxExcludedSet !== -1) {
      const percentiles = computePercentiles(entries.map((e) => e.edge));
      return percentiles[idxExcludedSet] ?? null;
    }
  }

  // Viewer absent from the excluded set → they're bot-excluded (§8.6: "excluded profiles get
  // their own percentile against the full set") — computed on demand, never cached.
  const allEntries = await getAllGradedPickScoresForQuestion(db, questionId);
  const idx = allEntries.findIndex((e) => e.profileId === profileId);
  if (idx === -1) return null; // genuinely no graded pick at all
  const allPercentiles = computePercentiles(allEntries.map((e) => e.edge));
  return allPercentiles[idx] ?? null;
}
