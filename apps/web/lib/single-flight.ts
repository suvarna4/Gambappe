/**
 * Redis-lock-based single-flight request coalescing (§6.2 step 4: "concurrent pickers await
 * one fetch, never N"). One caller per `key` wins the lock (`SET NX PX`) and actually runs
 * `fetcher`; everyone else polls for its published result until the lock is released. Behind a
 * narrow interface so it's unit-testable with an in-memory fake (matches the `GhostMintLimiter`
 * pattern, `ghost-mint-limiter.ts`) — no real Redis needed to verify coalescing.
 */

export interface SingleFlightRedis {
  /** `SET key value PX ttlMs NX` — returns `'OK'` iff the lock was acquired. */
  setNx(key: string, value: string, ttlMs: number): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  setResult(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface SingleFlightOptions {
  /** Bounds both the lock's lifetime and how long a follower waits (§6.2: "2s timeout"). */
  timeoutMs: number;
  pollIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fetcher()` under a per-`key` single-flight lock. The winner's result is published for
 * followers to read; a lock that's released with no published result (the winner's fetch threw
 * or timed out) resolves followers to `null` — same as if they'd fetched and failed themselves.
 */
export async function singleFlight<T>(
  redis: SingleFlightRedis,
  key: string,
  fetcher: () => Promise<T>,
  options: SingleFlightOptions,
): Promise<T | null> {
  const lockKey = `sf:lock:${key}`;
  const resultKey = `sf:result:${key}`;
  const pollIntervalMs = options.pollIntervalMs ?? 50;

  const acquired = await redis.setNx(lockKey, '1', options.timeoutMs);
  if (acquired === 'OK') {
    try {
      const result = await fetcher();
      await redis.setResult(resultKey, JSON.stringify(result), options.timeoutMs);
      return result;
    } finally {
      await redis.del(lockKey);
    }
  }

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const cached = await redis.get(resultKey);
    if (cached !== null) return JSON.parse(cached) as T;
    const stillLocked = await redis.get(lockKey);
    if (stillLocked === null) return null; // winner released the lock without publishing → failed
  }
  return null;
}
