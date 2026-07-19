/**
 * Audit findings 2.1–2.6 (§14.1): the previously-unwired rate limits, end-to-end against real
 * Postgres + Redis via the actual route handlers (mirrors `events.test.ts`'s pattern for
 * exercising `getDb()`/`getRedis()`-singleton-backed routes).
 *
 *   2.1  POST /api/v1/reports    → 10/day per profile
 *   2.2  POST /api/v1/claim     → 10/hour per IP
 *   2.3  any /api/v1 GET        → 600/min per IP backstop
 *   2.4  auth email sends       → 5/hour per email+IP (via `enforceAuthEmailSendLimit`)
 *   2.5  ghost-mint 429         → carries `Retry-After`
 *
 * `../../auth` (Auth.js) is mocked to a null session: these routes' identity comes from the
 * ghost cookie (reports) or doesn't matter for the limit under test (claim's limiter is
 * IP-keyed and checked before the session read) — and importing the real next-auth module
 * graph outside the Next.js runtime is exactly what `identity-request.ts`'s header warns
 * against in vitest.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { GHOST_MINT_PER_IP_PER_DAY, RL_CLAIM_IP_H, RL_GET_IP_MIN, RL_REPORT_PROFILE_D, RL_AUTH_EMAIL_H } from '@receipts/core';
import { connect, profiles, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';

vi.mock('../../auth', () => ({ auth: vi.fn(async () => null) }));

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });

  redis = new Redis(redisUrl);
  await redis.flushdb();

  // Route modules read their pg pool / Redis client from apps/web/lib/stores singletons —
  // point them at the migrated/flushed test instances before any route import.
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  process.env.GHOST_COOKIE_SECRET ??= 'integration-test-ghost-cookie-secret';
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

/** Same-origin mutation headers (passes `assertSameOrigin`) from a given client IP. */
function mutationHeaders(ip: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
    'x-forwarded-for': ip,
    ...extra,
  };
}

async function makeGhostWithCookie(): Promise<{ profileId: string; cookie: string }> {
  const { generateGhostSecret, hashGhostSecret, buildGhostCookieValue, GHOST_COOKIE_NAME } =
    await import('../../lib/ghost-cookie.js');
  const secret = generateGhostSecret();
  const profile = buildProfile({ kind: 'ghost', ghostSecretHash: hashGhostSecret(secret) });
  await db.insert(profiles).values(profile);
  const profileId = profile.id as string;
  return { profileId, cookie: `${GHOST_COOKIE_NAME}=${buildGhostCookieValue(profileId, secret)}` };
}

describe('POST /api/v1/reports rate limit (audit 2.1: 10/day per profile)', () => {
  it(`allows ${RL_REPORT_PROFILE_D} reports then 429s with Retry-After, per-profile isolated`, async () => {
    const { POST } = await import('../../app/api/v1/reports/route.js');
    const { cookie } = await makeGhostWithCookie();

    const submit = async (cookieHeader: string) =>
      POST(
        new Request('http://localhost/api/v1/reports', {
          method: 'POST',
          headers: mutationHeaders('198.51.100.10', { cookie: cookieHeader }),
          body: JSON.stringify({ context_kind: 'post', context_id: uuidv7(), reason: 'spam' }),
        }),
      );

    for (let i = 0; i < RL_REPORT_PROFILE_D; i++) {
      const res = await submit(cookie);
      expect(res.status, `report ${i + 1} should be under the limit`).toBe(201);
    }

    const limited = await submit(cookie);
    expect(limited.status).toBe(429);
    expect((await limited.json()) as never).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

    // Per-key isolation: a different profile is untouched by the first one's exhaustion.
    const other = await makeGhostWithCookie();
    const otherRes = await submit(other.cookie);
    expect(otherRes.status).toBe(201);
  });
});

describe('POST /api/v1/claim rate limit (audit 2.2: 10/hour per IP)', () => {
  it(`consumes the IP bucket before the session read and 429s past ${RL_CLAIM_IP_H}`, async () => {
    const { POST } = await import('../../app/api/v1/claim/route.js');

    const attempt = async (ip: string) =>
      POST(
        new Request('http://localhost/api/v1/claim', {
          method: 'POST',
          headers: mutationHeaders(ip),
          body: JSON.stringify({}),
        }),
      );

    for (let i = 0; i < RL_CLAIM_IP_H; i++) {
      const res = await attempt('198.51.100.20');
      // Mocked null session → UNAUTHENTICATED; the point is it consumed a token, not a 429.
      expect(res.status, `attempt ${i + 1} should be under the limit`).toBe(401);
    }

    const limited = await attempt('198.51.100.20');
    expect(limited.status).toBe(429);
    expect((await limited.json()) as never).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

    // Per-IP isolation.
    const otherIp = await attempt('198.51.100.21');
    expect(otherIp.status).toBe(401);
  });
});

describe('/api/v1 GET backstop (audit 2.3: 600/min per IP)', () => {
  it(
    `lets ${RL_GET_IP_MIN} GETs through then 429s with Retry-After; other IPs unaffected`,
    { timeout: 120_000 },
    async () => {
      const { GET } = await import('../../app/api/v1/questions/today/route.js');
      const get = (ip: string) =>
        GET(
          new Request('http://localhost/api/v1/questions/today', {
            headers: { 'x-forwarded-for': ip },
          }),
        );

      // The bucket refills continuously (600/60s ≈ 10 tokens/s), so an exact request count
      // is timing-dependent — instead hammer until the first 429 and assert the bucket held
      // at least its full capacity first (and didn't run away past capacity + a generous
      // refill allowance for the elapsed wall time).
      const startedAt = Date.now();
      let successes = 0;
      let limited: Response | null = null;
      for (let i = 0; i < RL_GET_IP_MIN * 3 && limited === null; i++) {
        const res = await get('198.51.100.30');
        if (res.status === 429) {
          limited = res;
        } else {
          expect(res.status).toBe(404); // no daily question seeded — fine, it consumed a token
          successes += 1;
        }
      }

      expect(limited, 'the backstop never fired').not.toBeNull();
      expect(successes).toBeGreaterThanOrEqual(RL_GET_IP_MIN);
      const refillAllowance = Math.ceil(((Date.now() - startedAt) / 1000 + 1) * (RL_GET_IP_MIN / 60));
      expect(successes).toBeLessThanOrEqual(RL_GET_IP_MIN + refillAllowance);
      expect((await limited!.json()) as never).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);

      // Per-IP isolation: a different IP still gets through.
      const other = await get('198.51.100.31');
      expect(other.status).toBe(404);
    },
  );
});

describe('ghost-mint 429 (audit 2.5: Retry-After present)', () => {
  it(`mints ${GHOST_MINT_PER_IP_PER_DAY} ghosts per IP then 429s WITH Retry-After`, async () => {
    const { POST } = await import('../../app/api/v1/reactions/route.js');
    const react = () =>
      POST(
        new Request('http://localhost/api/v1/reactions', {
          method: 'POST',
          // Anonymous (no cookie) → each request lazily mints a fresh ghost (§6.1.1).
          headers: mutationHeaders('198.51.100.40'),
          body: JSON.stringify({ context_kind: 'question', context_id: uuidv7(), emoji: '🔥' }),
        }),
      );

    for (let i = 0; i < GHOST_MINT_PER_IP_PER_DAY; i++) {
      const res = await react();
      // The random question id doesn't exist — 404 — but the mint (the thing under test)
      // already happened and consumed this IP's mint quota.
      expect(res.status, `mint ${i + 1} should be under the limit`).toBe(404);
    }

    const limited = await react();
    expect(limited.status).toBe(429);
    expect((await limited.json()) as never).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    const retryAfter = Number(limited.headers.get('retry-after'));
    // The mint bucket is a per-UTC-day counter — Retry-After is the time to the next UTC
    // midnight: positive, never more than a day.
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
  });
});

describe('auth email-send limit (audit 2.4: 5/hour per email+IP)', () => {
  const headersFor = (ip: string) => new Headers({ 'x-forwarded-for': ip });

  it(`allows ${RL_AUTH_EMAIL_H} sends, then throws RATE_LIMITED — casing variants share one bucket`, async () => {
    const { enforceAuthEmailSendLimit } = await import('../../lib/auth-email-limit.js');

    for (let i = 0; i < RL_AUTH_EMAIL_H; i++) {
      await expect(
        enforceAuthEmailSendLimit('Target@Example.com', headersFor('198.51.100.50')),
      ).resolves.toBeUndefined();
    }

    // 6th send over-limit — and via a casing variant, proving the key is normalized.
    await expect(
      enforceAuthEmailSendLimit('target@example.com', headersFor('198.51.100.50')),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    // email+IP key: same email from a different IP, and a different email from the same IP,
    // are both separate buckets.
    await expect(
      enforceAuthEmailSendLimit('target@example.com', headersFor('198.51.100.51')),
    ).resolves.toBeUndefined();
    await expect(
      enforceAuthEmailSendLimit('someone-else@example.com', headersFor('198.51.100.50')),
    ).resolves.toBeUndefined();
  });
});
