/**
 * §6.2 step 4 single-flight request coalescing: "concurrent pickers await one fetch, never N."
 * In-memory fake Redis (no real Redis needed — mirrors the `GhostMintLimiter` test-double
 * pattern, `ghost-mint-limiter.ts`).
 */
import { describe, expect, it, vi } from 'vitest';
import { singleFlight, type SingleFlightRedis } from '@/lib/single-flight';

class FakeRedis implements SingleFlightRedis {
  private readonly store = new Map<string, string>();

  async setNx(key: string, value: string, _ttlMs: number): Promise<'OK' | null> {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setResult(key: string, value: string, _ttlMs: number): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('singleFlight (§6.2 step 4)', () => {
  it('runs the fetcher once for concurrent callers on the same key; all get the same result', async () => {
    const redis = new FakeRedis();
    const fetcher = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { yesPrice: 0.42 };
    });

    const [a, b, c] = await Promise.all([
      singleFlight(redis, 'kalshi:MKT-1', fetcher, { timeoutMs: 500, pollIntervalMs: 5 }),
      singleFlight(redis, 'kalshi:MKT-1', fetcher, { timeoutMs: 500, pollIntervalMs: 5 }),
      singleFlight(redis, 'kalshi:MKT-1', fetcher, { timeoutMs: 500, pollIntervalMs: 5 }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ yesPrice: 0.42 });
    expect(b).toEqual({ yesPrice: 0.42 });
    expect(c).toEqual({ yesPrice: 0.42 });
  });

  it('different keys never coalesce — each gets its own fetch', async () => {
    const redis = new FakeRedis();
    const fetcher = vi.fn(async () => 'ok');

    await Promise.all([
      singleFlight(redis, 'market-a', fetcher, { timeoutMs: 500, pollIntervalMs: 5 }),
      singleFlight(redis, 'market-b', fetcher, { timeoutMs: 500, pollIntervalMs: 5 }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('followers resolve to null if the winner fetch throws (lock released, no result published)', async () => {
    const redis = new FakeRedis();
    const winnerFetcher = async () => {
      // Delayed failure — long enough that the follower observes the lock still held before
      // it's released, so it polls/waits instead of racing to become the new winner itself.
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('adapter down');
    };
    const followerFetcher = vi.fn(async () => 'should never run');

    const winnerPromise = singleFlight(redis, 'k', winnerFetcher, { timeoutMs: 200, pollIntervalMs: 5 }).catch(
      () => 'winner-threw',
    );
    // Give the winner a tick to acquire the lock before the follower starts polling.
    await new Promise((r) => setTimeout(r, 1));
    const followerPromise = singleFlight(redis, 'k', followerFetcher, { timeoutMs: 200, pollIntervalMs: 5 });

    const [winnerOutcome, followerOutcome] = await Promise.all([winnerPromise, followerPromise]);
    expect(winnerOutcome).toBe('winner-threw');
    expect(followerOutcome).toBeNull();
    expect(followerFetcher).not.toHaveBeenCalled();
  });
});
