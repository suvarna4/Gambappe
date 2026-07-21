/**
 * WS18-T1 integration: `GET /api/v1/stack` through the REAL route handler against real
 * Postgres + Redis. Covers the journeys-plan §4/§5 AC: flag-gating (`topic_markets` off →
 * `topics: []`), follow filtering, the all-categories ghost default, the cap of 8 soonest-close
 * first, exclusion of non-open / non-topic questions, and the serialization-masking invariant
 * (topic cards never leak an outcome). Mirrors `pairing-reactions-route.test.ts`'s pattern for
 * exercising `getDb()`/`getRedis()`-singleton routes with a mocked `../../auth` (real next-auth
 * can't resolve outside the Next.js runtime under plain vitest — see `identity-request.ts`).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { etDateString, type MarketCategory } from '@receipts/core';
import { connect, markets, questions, profiles, topicFollows, type Db } from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion, buildTopicFollow } from '@receipts/db/testing';

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
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE topic_follows, picks, questions, markets, profiles, users RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
  delete process.env.FLAG_TOPIC_MARKETS;
});

/** A fresh IP per call so the per-IP GET backstop never trips across a test's requests. */
function getHeaders(extra: Record<string, string> = {}): Record<string, string> {
  ipCounter += 1;
  return { 'x-forwarded-for': `203.0.113.${ipCounter % 250}`, ...extra };
}

async function callStack(headers: Record<string, string> = {}): Promise<{
  status: number;
  body: { data: { headliner: unknown; topics: Array<{ slug: string; kind: string; outcome: unknown }> } };
}> {
  const { GET } = await import('../../app/api/v1/stack/route.js');
  const res = await GET(new Request('http://localhost/api/v1/stack', { method: 'GET', headers: getHeaders(headers) }));
  return { status: res.status, body: (await res.json()) as never };
}

/** Insert an open topic question on a market of the given category, closing at `closeTime`. */
async function insertTopic(category: MarketCategory, closeTime: Date, slug: string): Promise<void> {
  const market = buildMarket({ category, closeTime, status: 'open' });
  await db.insert(markets).values(market);
  await db.insert(questions).values(
    buildQuestion(market.id as string, {
      kind: 'topic',
      questionDate: null,
      status: 'open',
      slug,
      openAt: new Date(closeTime.getTime() - 3600_000),
      lockAt: closeTime,
    }),
  );
}

async function makeGhostWithCookie(): Promise<{ profileId: string; cookie: string }> {
  const { generateGhostSecret, hashGhostSecret, buildGhostCookieValue, GHOST_COOKIE_NAME } = await import(
    '../../lib/ghost-cookie.js'
  );
  const secret = generateGhostSecret();
  const profile = buildProfile({ kind: 'ghost', ghostSecretHash: hashGhostSecret(secret) });
  await db.insert(profiles).values(profile);
  const profileId = profile.id as string;
  return { profileId, cookie: `${GHOST_COOKIE_NAME}=${buildGhostCookieValue(profileId, secret)}` };
}

const T = new Date('2026-08-01T12:00:00Z').getTime();

describe('GET /api/v1/stack (WS18-T1, real route handler)', () => {
  it('flag OFF → topics is empty even when open topic questions exist', async () => {
    await insertTopic('economics', new Date(T + 3600_000), 'topic-off-1');
    await insertTopic('sports', new Date(T + 7200_000), 'topic-off-2');

    const { status, body } = await callStack();
    expect(status).toBe(200);
    expect(body.data.topics).toEqual([]);
  });

  it('flag ON, anonymous/no-follows → all categories (the ghost default)', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    await insertTopic('economics', new Date(T + 3600_000), 'topic-all-eco');
    await insertTopic('sports', new Date(T + 7200_000), 'topic-all-sport');
    await insertTopic('culture', new Date(T + 10_800_000), 'topic-all-culture');

    const { body } = await callStack();
    const slugs = body.data.topics.map((t) => t.slug);
    expect(slugs).toContain('topic-all-eco');
    expect(slugs).toContain('topic-all-sport');
    expect(slugs).toContain('topic-all-culture');
  });

  it('flag ON, ghost WITH follows → only followed categories', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    const { profileId, cookie } = await makeGhostWithCookie();
    await db.insert(topicFollows).values(buildTopicFollow(profileId, { category: 'economics' }));

    await insertTopic('economics', new Date(T + 3600_000), 'topic-follow-eco');
    await insertTopic('sports', new Date(T + 7200_000), 'topic-follow-sport');

    const { body } = await callStack({ cookie });
    const slugs = body.data.topics.map((t) => t.slug);
    expect(slugs).toEqual(['topic-follow-eco']);
  });

  it('flag ON → caps at 8, soonest-close first', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    // 10 open topics, closing at T+1h .. T+10h. Insert out of order to prove the ordering.
    const order = [5, 2, 9, 1, 7, 3, 10, 4, 8, 6];
    for (const h of order) {
      await insertTopic('economics', new Date(T + h * 3600_000), `topic-cap-${String(h).padStart(2, '0')}`);
    }

    const { body } = await callStack();
    expect(body.data.topics).toHaveLength(8);
    const slugs = body.data.topics.map((t) => t.slug);
    expect(slugs).toEqual([
      'topic-cap-01',
      'topic-cap-02',
      'topic-cap-03',
      'topic-cap-04',
      'topic-cap-05',
      'topic-cap-06',
      'topic-cap-07',
      'topic-cap-08',
    ]);
  });

  it('flag ON → excludes non-open topics, non-topic kinds; topic cards never leak an outcome', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';

    // An OPEN topic → included.
    await insertTopic('economics', new Date(T + 3600_000), 'topic-open');

    // A LOCKED topic carrying an outcome (settled-but-unrevealed) → excluded (status !== 'open').
    const lockedMarket = buildMarket({ category: 'economics', status: 'open', closeTime: new Date(T + 3600_000) });
    await db.insert(markets).values(lockedMarket);
    await db.insert(questions).values(
      buildQuestion(lockedMarket.id as string, {
        kind: 'topic',
        questionDate: null,
        status: 'locked',
        slug: 'topic-locked',
        outcome: 'yes',
      }),
    );

    // A DAILY question → never a topic card (kind filter).
    const dailyMarket = buildMarket({ category: 'economics', status: 'open' });
    await db.insert(markets).values(dailyMarket);
    await db.insert(questions).values(
      buildQuestion(dailyMarket.id as string, { kind: 'daily', status: 'open', slug: 'a-daily-question' }),
    );

    const { body } = await callStack();
    const slugs = body.data.topics.map((t) => t.slug);
    expect(slugs).toEqual(['topic-open']);
    expect(body.data.topics.every((t) => t.kind === 'topic')).toBe(true);
    expect(body.data.topics.every((t) => t.outcome === null)).toBe(true);
  });

  it("headliner reflects today's daily question (ET)", async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    const today = etDateString(new Date());
    const market = buildMarket({ category: 'politics', status: 'open' });
    await db.insert(markets).values(market);
    await db.insert(questions).values(
      buildQuestion(market.id as string, {
        kind: 'daily',
        questionDate: today,
        status: 'open',
        slug: `${today}-headliner-daily-${uuidv7().slice(0, 8)}`,
        openAt: new Date(Date.now() - 3600_000),
        lockAt: new Date(Date.now() + 3600_000),
        revealAt: new Date(Date.now() + 7200_000),
      }),
    );

    const { body } = await callStack();
    expect(body.data.headliner).not.toBeNull();
    expect((body.data.headliner as { kind: string }).kind).toBe('daily');
  });
});
