/**
 * SIWE nonce store (design doc §12.2): Redis `siwe:{nonce}` → profileId, `SIWE_NONCE_TTL_MIN`
 * TTL, single-use. Same interface-based shape as `ghost-mint-limiter.ts` — an in-memory fake
 * for unit tests, a Redis-backed real adapter exercised by CI integration tests only (no Redis
 * available in this sandbox). `consume` is a single ATOMIC read-then-delete (Lua script) so a
 * replayed nonce can never win a race against its own first, legitimate consumption — the
 * WS12-T1 "replayed nonce → rejected" AC.
 */
import type { Redis } from 'ioredis';

export interface WalletNonceStore {
  /** Stores `nonce -> profileId`, single-use, expiring after `ttlSeconds`. */
  save(nonce: string, profileId: string, ttlSeconds: number): Promise<void>;
  /** Atomically reads AND deletes; returns the bound profileId, or `null` if missing/expired/already consumed. */
  consume(nonce: string): Promise<string | null>;
}

function redisKey(nonce: string): string {
  return `siwe:${nonce}`;
}

/** Test double — single-process, no real TTL sweep (fine for short-lived test runs). */
export class InMemoryWalletNonceStore implements WalletNonceStore {
  private readonly entries = new Map<string, { profileId: string; expiresAtMs: number }>();

  async save(nonce: string, profileId: string, ttlSeconds: number): Promise<void> {
    this.entries.set(redisKey(nonce), { profileId, expiresAtMs: Date.now() + ttlSeconds * 1000 });
  }

  async consume(nonce: string): Promise<string | null> {
    const key = redisKey(nonce);
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key); // single-use regardless of outcome below
    if (entry.expiresAtMs < Date.now()) return null;
    return entry.profileId;
  }
}

/** GET-then-DEL as one atomic Lua script — no separate GET/DEL race window. */
const CONSUME_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v
`;

export class RedisWalletNonceStore implements WalletNonceStore {
  constructor(private readonly redis: Pick<Redis, 'set' | 'eval'>) {}

  async save(nonce: string, profileId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(redisKey(nonce), profileId, 'EX', ttlSeconds);
  }

  async consume(nonce: string): Promise<string | null> {
    const result = await this.redis.eval(CONSUME_SCRIPT, 1, redisKey(nonce));
    return typeof result === 'string' ? result : null;
  }
}
