/**
 * Shared rate limiter (§14.1, WS11-T1): Redis token bucket per key. Middleware order per
 * spec is origin check → identity → limiter; this module is the limiter step, called
 * explicitly by each mutation route (there is no single global Next middleware doing this,
 * since the key — IP, profile, email+IP, or global — varies per action).
 *
 * Redis-down posture is FAIL-CLOSED (§14.1): if the store is unreachable, callers fall back
 * to a strict in-process bucket at `RL_FAIL_CLOSED_FRACTION` (25%) of the configured limit —
 * never unlimited. The fallback is logged so it can be alerted on (§16.1).
 */
import { NextResponse } from 'next/server';
import type { ClientContext, Redis } from 'ioredis';
import { nowMs, RL_FAIL_CLOSED_FRACTION } from '@receipts/core';
import { logger } from './logger';
import { RATE_LIMIT_RULES, type RateLimitAction } from './rate-limit-rules';
import { ensureRedisConnected, getRedis } from './stores';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * KEYS[1] = bucket key. ARGV: capacity, refillRatePerSecond, nowMs, ttlSeconds.
 * Returns {allowed(0|1), tokensRemaining}. Runs atomically (Lua scripts are single-threaded
 * in Redis) so concurrent requests against the same key can't both read-then-write stale state.
 */
const TOKEN_BUCKET_LUA = `
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local lastTs = tonumber(bucket[2])
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

if tokens == nil then
  tokens = capacity
  lastTs = now
end

local elapsedSeconds = math.max(0, now - lastTs) / 1000
tokens = math.min(capacity, tokens + elapsedSeconds * refillRate)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('EXPIRE', KEYS[1], ttl)

return {allowed, tostring(tokens)}
`;

declare module 'ioredis' {
  // Context must match ioredis's own RedisCommander<Context> signature exactly for this
  // declaration merge to work — it isn't unused, ESLint just can't see that from here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    tokenBucket(
      key: string,
      capacity: number,
      refillRatePerSecond: number,
      nowMs: number,
      ttlSeconds: number,
    ): Promise<[number, string]>;
  }
}

const definedOn = new WeakSet<Redis>();

function ensureCommandDefined(redis: Redis): void {
  if (definedOn.has(redis)) return;
  redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
  definedOn.add(redis);
}

export function retryAfterSeconds(tokensRemaining: number, refillRatePerSecond: number): number {
  if (tokensRemaining >= 1) return 0;
  return Math.max(1, Math.ceil((1 - tokensRemaining) / refillRatePerSecond));
}

/** capacity / windowSeconds — how many tokens regenerate per second. */
export function refillRateFor(capacity: number, windowSeconds: number): number {
  return capacity / windowSeconds;
}

async function checkRedisBucket(
  redis: Redis,
  key: string,
  capacity: number,
  windowSeconds: number,
  now: number,
): Promise<RateLimitResult> {
  await ensureRedisConnected(redis);
  ensureCommandDefined(redis);
  const refillRate = refillRateFor(capacity, windowSeconds);
  const ttlSeconds = Math.ceil(windowSeconds * 2);
  const [allowed, tokensStr] = await redis.tokenBucket(key, capacity, refillRate, now, ttlSeconds);
  const tokens = Number(tokensStr);
  return {
    allowed: allowed === 1,
    remaining: Math.floor(tokens),
    retryAfterSeconds: retryAfterSeconds(tokens, refillRate),
  };
}

// In-process fallback state (per Node instance, by design — §14.1). Never persisted.
const fallbackBuckets = new Map<string, { tokens: number; ts: number }>();

/** Same algorithm as the Lua script, but pure JS over a local Map — used only when Redis is down. */
function checkInProcessBucket(
  key: string,
  capacity: number,
  windowSeconds: number,
  now: number,
): RateLimitResult {
  const refillRate = refillRateFor(capacity, windowSeconds);
  const existing = fallbackBuckets.get(key);
  let tokens = existing?.tokens ?? capacity;
  const lastTs = existing?.ts ?? now;

  const elapsedSeconds = Math.max(0, now - lastTs) / 1000;
  tokens = Math.min(capacity, tokens + elapsedSeconds * refillRate);

  const allowed = tokens >= 1;
  if (allowed) tokens -= 1;

  fallbackBuckets.set(key, { tokens, ts: now });
  return {
    allowed,
    remaining: Math.floor(tokens),
    retryAfterSeconds: retryAfterSeconds(tokens, refillRate),
  };
}

/**
 * Checks and consumes one token from `key`'s bucket (capacity `limit` over `windowSeconds`).
 * Falls back to a strict in-process bucket at `RL_FAIL_CLOSED_FRACTION` of `limit` if Redis
 * throws — logged as a warning so the fallback is observable (§16.1 alerting).
 */
export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  try {
    return await checkRedisBucket(redis, key, limit, windowSeconds, now);
  } catch (err) {
    logger.warn(
      { err, key },
      'checkRateLimit: Redis unavailable, falling back to strict in-process limit (§14.1)',
    );
    const fallbackCapacity = Math.max(1, Math.floor(limit * RL_FAIL_CLOSED_FRACTION));
    return checkInProcessBucket(key, fallbackCapacity, windowSeconds, now);
  }
}

/**
 * The "one shared middleware" route handlers call directly (§14.1) — looks up `action`'s
 * rule, checks the bucket for `identifier` (an IP, profile id, "email:ip" pair, or a fixed
 * string for `global` actions), and returns a ready-to-return 429 response, or null to
 * continue. Middleware order per spec is origin check → identity → limiter — call this
 * after resolving identity/origin, with whatever identifier that resolution produced.
 */
export async function enforceRateLimit(
  action: RateLimitAction,
  identifier: string,
): Promise<NextResponse | null> {
  const rule = RATE_LIMIT_RULES[action];
  const bucketKey = `ratelimit:${action}:${identifier}`;
  const result = await checkRateLimit(getRedis(), bucketKey, rule.limit, rule.windowSeconds, nowMs());
  if (result.allowed) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    {
      status: 429,
      headers: {
        'retry-after': String(result.retryAfterSeconds),
        'x-server-time': String(nowMs()),
      },
    },
  );
}
