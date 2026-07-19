/**
 * WS7-T4 integration: `GET /api/v1/profiles/:slug` and `GET /api/v1/profiles/:slug/picks`
 * end-to-end against real Postgres — the actual HTTP envelope shape (§9.1: every response
 * schema in the registry describes what sits under the outer success envelope's `data` key,
 * confirmed by this suite's own assertions, matching the already-shipped `POST /events`/
 * thread-response convention), the cache header (§9.1 default `s-maxage=30`), and 404s for a
 * deleted profile and an unknown slug (WS7-T4 AC) — never a 500.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import {
  connect,
  insertMarket,
  insertPick,
  insertProfile,
  insertQuestion,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'drizzle',
    ),
  });
  process.env.DATABASE_URL = dbUrl;
  // The GET routes under test now consume the §14.1 GET backstop (audit 2.3), whose limiter
  // reads `getRedis()` — REDIS_URL must resolve (CI sets it; default matches events.test.ts).
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE picks, questions, markets, profiles RESTART IDENTITY CASCADE`);
});

async function getProfile(slug: string) {
  const { GET } = await import('../../app/api/v1/profiles/[slug]/route.js');
  const request = new Request(`http://localhost/api/v1/profiles/${slug}`);
  const response = await GET(request, { params: Promise.resolve({ slug }) });
  return {
    status: response.status,
    headers: response.headers,
    json: (await response.json()) as unknown,
  };
}

async function getProfilePicks(slug: string, qs = '') {
  const { GET } = await import('../../app/api/v1/profiles/[slug]/picks/route.js');
  const request = new Request(`http://localhost/api/v1/profiles/${slug}/picks${qs}`);
  const response = await GET(request, { params: Promise.resolve({ slug }) });
  return {
    status: response.status,
    headers: response.headers,
    json: (await response.json()) as unknown,
  };
}

describe('GET /api/v1/profiles/:slug (§9.2)', () => {
  it('404s (VALIDATION-free NOT_FOUND) for an unknown slug', async () => {
    const { status, json } = await getProfile('nobody-here');
    expect(status).toBe(404);
    expect(json).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('404s for a deleted profile (WS7-T4 AC)', async () => {
    const profile = await insertProfile(db, buildProfile({ status: 'deleted' }));
    const { status } = await getProfile(profile.slug);
    expect(status).toBe(404);
  });

  it('200s with the profile nested under `data`, cacheable, and x-server-time set', async () => {
    const profile = await insertProfile(db, buildProfile());
    const { status, json, headers } = await getProfile(profile.slug);
    expect(status).toBe(200);
    expect(json).toMatchObject({ data: { handle: profile.handle, slug: profile.slug } });
    expect(headers.get('cache-control')).toBe('public, s-maxage=30, stale-while-revalidate=300');
    expect(headers.get('x-server-time')).toBeTruthy();
  });
});

describe('GET /api/v1/profiles/:slug/picks (§9.2, §9.1 pagination)', () => {
  it('404s for a deleted profile', async () => {
    const profile = await insertProfile(db, buildProfile({ status: 'deleted' }));
    const { status } = await getProfilePicks(profile.slug);
    expect(status).toBe(404);
  });

  it('200s with the §9.1 list envelope nested under the outer `data` key (matches the already-shipped thread/events convention)', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { status: 'revealed', revealedAt: new Date() }),
    );
    await insertPick(db, buildPick(question.id, profile.id, { result: 'win', edge: 0.3 }));

    const { status, json } = await getProfilePicks(profile.slug);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      data: {
        data: [{ question_id: question.id, result: 'win' }],
        meta: { next_cursor: null },
      },
    });
  });

  it('rejects a limit above PAGINATION_MAX_LIMIT (400, not silently clamped)', async () => {
    const profile = await insertProfile(db, buildProfile());
    const { status, json } = await getProfilePicks(profile.slug, '?limit=999');
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('honors an explicit small limit and returns a usable next_cursor', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    for (let i = 0; i < 3; i++) {
      const q = await insertQuestion(
        db,
        buildQuestion(market.id, {
          status: 'revealed',
          revealedAt: new Date(),
          questionDate: `2026-04-0${i + 1}`,
        }),
      );
      await insertPick(
        db,
        buildPick(q.id, profile.id, { pickedAt: new Date(Date.now() + i * 1000) }),
      );
    }

    const { json } = await getProfilePicks(profile.slug, '?limit=1');
    const body = json as { data: { data: unknown[]; meta: { next_cursor: string | null } } };
    expect(body.data.data).toHaveLength(1);
    expect(body.data.meta.next_cursor).not.toBeNull();
  });
});
