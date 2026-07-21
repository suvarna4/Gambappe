/**
 * WS18-T2 integration: `POST | DELETE /api/v1/topics/:category/follow` through the REAL route
 * handlers against real Postgres + Redis. Covers the journeys-plan §5 AC: ghost-allowed follows
 * that persist per profile, optimistic-safe idempotency, `topic_markets` flag gating (404 off),
 * and unknown-category rejection. Mirrors `stack-feed-route.test.ts`'s harness.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { connect, getFollows, topicFollows, type Db } from '@receipts/db';

vi.mock('../../auth', () => ({ auth: vi.fn(async () => null) }));

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;
let ipCounter = 0;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
  redis = new Redis(redisUrl);
  await redis.flushdb();
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  process.env.GHOST_COOKIE_SECRET ??= 'integration-test-ghost-cookie-secret';

  // Warm the app's Redis singleton (getRedis) — the ghost-mint limiter has no offline queue and
  // throws if the very first request lands before the connection is up.
  const { ensureRedisConnected, getRedis } = await import('../../lib/stores.js');
  await ensureRedisConnected(getRedis());
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE topic_follows, profiles, users RESTART IDENTITY CASCADE`);
  await redis.flushdb();
  process.env.FLAG_TOPIC_MARKETS = 'true';
});

function headers(extra: Record<string, string> = {}): Record<string, string> {
  ipCounter += 1;
  return {
    'x-forwarded-for': `203.0.113.${ipCounter % 250}`,
    'sec-fetch-site': 'same-origin',
    ...extra,
  };
}

async function follow(method: 'POST' | 'DELETE', category: string, cookie?: string) {
  const mod = await import('../../app/api/v1/topics/[category]/follow/route.js');
  const handler = method === 'POST' ? mod.POST : mod.DELETE;
  const res = await handler(
    new Request(`http://localhost:3000/api/v1/topics/${category}/follow`, {
      method,
      headers: headers(cookie ? { cookie } : {}),
    }),
    { params: Promise.resolve({ category }) },
  );
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: (await res.json()) as { data?: { category: string; following: boolean }; error?: { code: string } }, setCookie };
}

/** Extract the ghost cookie name=value pair to replay on a subsequent request. */
function ghostCookie(setCookie: string | null): string {
  if (!setCookie) throw new Error('expected a ghost cookie to be minted');
  return setCookie.split(';')[0]!;
}

describe('POST/DELETE /api/v1/topics/:category/follow (WS18-T2)', () => {
  it('a ghost can follow, and the follow persists for that same ghost across requests', async () => {
    const first = await follow('POST', 'economics');
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ category: 'economics', following: true });
    const cookie = ghostCookie(first.setCookie);

    // Same ghost follows a second category.
    const second = await follow('POST', 'sports', cookie);
    expect(second.body.data?.following).toBe(true);

    // Resolve the ghost's profile id from the one row, then assert both persisted.
    const [row] = await db.select().from(topicFollows);
    const profileId = row!.profileId;
    expect((await getFollows(db, profileId)).sort()).toEqual(['economics', 'sports']);

    // Unfollow one.
    const del = await follow('DELETE', 'economics', cookie);
    expect(del.body.data).toEqual({ category: 'economics', following: false });
    expect(await getFollows(db, profileId)).toEqual(['sports']);
  });

  it('re-following the same category is idempotent (optimistic double-tap safe)', async () => {
    const first = await follow('POST', 'culture');
    const cookie = ghostCookie(first.setCookie);
    await follow('POST', 'culture', cookie);
    const rows = await db.select().from(topicFollows);
    expect(rows).toHaveLength(1);
  });

  it('404s when topic_markets is off', async () => {
    delete process.env.FLAG_TOPIC_MARKETS;
    const res = await follow('POST', 'economics');
    expect(res.status).toBe(404);
    expect(await db.select().from(topicFollows)).toHaveLength(0);
  });

  it('rejects an unknown category', async () => {
    const res = await follow('POST', 'weather');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});
