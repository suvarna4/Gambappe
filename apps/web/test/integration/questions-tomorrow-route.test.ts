/**
 * Design-diff audit integration test: `GET /api/v1/questions/tomorrow` (§9.2 contract-change,
 * the peeking next-day card — `docs/swipe-ux-plan.md` §2.5's under-card AC) against REAL
 * Postgres + Redis, through the actual route handler. Mirrors `rate-limit-routes.test.ts`'s setup
 * (both stores are singleton-backed via `apps/web/lib/stores`, so both must be pointed at the
 * migrated/flushed test instances before the route module is imported) and
 * `question-view.test.ts`'s query-layer assertions (draft-exclusion, effective-status derivation)
 * — this file is the "real HTTP route" counterpart neither of those two covers on its own.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import { setTestClock } from '@receipts/core';

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

  // Route modules read their pg pool / Redis client from apps/web/lib/stores singletons — point
  // them at the migrated/flushed test instances before any route import (rate-limit-routes.test
  // .ts's own precedent).
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE questions, markets RESTART IDENTITY CASCADE`);
});

afterEach(() => {
  setTestClock(null);
});

async function insertMarketAndQuestion(
  marketOverrides: Parameters<typeof buildMarket>[0] = {},
  questionOverrides: Parameters<typeof buildQuestion>[1] = {},
) {
  const market = buildMarket(marketOverrides);
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, questionOverrides);
  await db.insert(questions).values(question);
  return { market, question };
}

async function get(): Promise<Response> {
  const { GET } = await import('../../app/api/v1/questions/tomorrow/route.js');
  return GET(new Request('http://localhost/api/v1/questions/tomorrow'));
}

// "today" throughout this file is 2026-09-10 (09:00 ET) via `setTestClock` below.
const TOMORROW = '2026-09-11';

describe('GET /api/v1/questions/tomorrow (design-diff audit, §9.2)', () => {
  it('404s when curation has not reached tomorrow yet — never a broken/empty 200', async () => {
    setTestClock('2026-09-10T13:00:00Z');
    const res = await get();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns the narrow peek shape for a real scheduled tomorrow — no headline, price, or crowd', async () => {
    setTestClock('2026-09-10T13:00:00Z');
    const { question } = await insertMarketAndQuestion(
      { yesPrice: 0.71 },
      {
        kind: 'daily',
        questionDate: TOMORROW,
        status: 'scheduled',
        headline: 'A headline that must never leak here',
        openAt: new Date('2026-09-11T13:00:00Z'),
        lockAt: new Date('2026-09-11T16:00:00Z'),
      },
    );
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      status: 'scheduled',
      open_at: (question.openAt as Date).toISOString(),
    });
    expect(Object.keys(body.data)).toEqual(['status', 'open_at']);
  });

  it('404s for a draft tomorrow — never serves an unpublished question', async () => {
    setTestClock('2026-09-10T13:00:00Z');
    await insertMarketAndQuestion({}, { questionDate: TOMORROW, status: 'draft' });
    const res = await get();
    expect(res.status).toBe(404);
  });

  it('404s once "tomorrow" has already opened (e.g. an admin early-open) — not "tomorrow, unopened" anymore', async () => {
    // Raw status already 'open' — `effectiveQuestionStatus` returns a raw non-draft/voided
    // status immediately regardless of timestamps, so this alone is enough to disqualify it
    // (an admin early-open is the only realistic way this branch is reached in practice: under
    // the normal DD-1 schedule, a question's `open_at` sits on ITS OWN calendar date at 09:00
    // ET, which can never be in the past while `today` — the reference this test's `TEST_CLOCK`
    // also drives — still reads as the PRIOR calendar date).
    setTestClock('2026-09-10T13:00:00Z');
    await insertMarketAndQuestion(
      {},
      {
        questionDate: TOMORROW,
        status: 'open',
        openAt: new Date('2026-09-11T13:00:00Z'),
        lockAt: new Date('2026-09-11T16:00:00Z'),
      },
    );
    const res = await get();
    expect(res.status).toBe(404);
  });

  it('404s for a voided tomorrow (a voided slot reads as free, same as GET /questions/today)', async () => {
    setTestClock('2026-09-10T13:00:00Z');
    await insertMarketAndQuestion({}, { questionDate: TOMORROW, status: 'voided' });
    const res = await get();
    expect(res.status).toBe(404);
  });

  it('ignores a daily question dated two days out — never a fuzzy "next available" search', async () => {
    setTestClock('2026-09-10T13:00:00Z');
    await insertMarketAndQuestion({}, { questionDate: '2026-09-12', status: 'scheduled' });
    const res = await get();
    expect(res.status).toBe(404);
  });

  it('sets a short public cache-control header, matching GET /questions/today', async () => {
    // `buildQuestion`'s default `openAt`/`lockAt` anchor to REAL wall-clock time (so they stay
    // safely in the future for tests that don't override `TEST_CLOCK` at all — see that
    // factory's own header comment) — with `TEST_CLOCK` pinned to a fixed instant here, those
    // defaults would be stale relative to it and derive the row's effective status past
    // `scheduled` (§5.7), 404-ing before the header is ever set. Override them to stay near
    // `TEST_CLOCK`, same as the "returns the narrow peek shape" test above.
    setTestClock('2026-09-10T13:00:00Z');
    await insertMarketAndQuestion(
      {},
      {
        questionDate: TOMORROW,
        status: 'scheduled',
        openAt: new Date('2026-09-11T13:00:00Z'),
        lockAt: new Date('2026-09-11T16:00:00Z'),
      },
    );
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=10');
  });
});
