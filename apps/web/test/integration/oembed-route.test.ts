/**
 * WS8-T4 integration: `GET /api/oembed` against real Postgres + Redis. Covers the task's
 * acceptance criteria directly: a syntactically-matching but nonexistent slug/id still 404s
 * (entity-existence check, not just pattern-match), a real entity of each of the four known
 * route shapes returns a spec-shaped oEmbed body, and `format=xml` (unsupported) 404s. The
 * dedicated SSRF-rejection AC is covered by the pure-function unit suite
 * (`test/oembed-ssrf.test.ts`) — no database needed for that half, by design (the parser never
 * touches the DB for a request it's already rejected on host/scheme/path grounds).
 */
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME } from '@receipts/core';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { connect, duos, nemesisPairings, profiles, seasons, type Db } from '@receipts/db';
import { buildProfile, insertGradedQuestionScenario } from '@receipts/db/testing';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
const APP_ORIGIN = 'http://localhost:3000';

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

  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

async function oembedGet(searchParams: Record<string, string>): Promise<Response> {
  const { GET } = await import('../../app/api/oembed/route.js');
  const qs = new URLSearchParams(searchParams).toString();
  const request = new Request(`${APP_ORIGIN}/api/oembed?${qs}`, {
    headers: { 'x-forwarded-for': '203.0.113.11' },
  });
  return GET(request);
}

describe('GET /api/oembed — question', () => {
  it('404s for a syntactically-matching but nonexistent slug', async () => {
    const res = await oembedGet({ url: '/q/does-not-exist' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns a rich oEmbed body for a real revealed question, via the relative-path url shape', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const res = await oembedGet({ url: `/q/${question.slug}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe('rich');
    expect(body.version).toBe('1.0');
    expect(body.title).toBe(question.headline);
    expect(body.provider_name).toBe(PRODUCT_NAME);
    expect(body.width).toBe(1200);
    expect(body.height).toBe(630);
    expect(typeof body.thumbnail_url).toBe('string');
    expect(body.thumbnail_url as string).toContain(`/api/og/question/${question.slug}?v=`);
    expect(body.html as string).toContain(body.thumbnail_url as string);
  });

  it('also matches the absolute-URL url= shape (what /p/[slug] emits)', async () => {
    // The matcher requires an https absolute scheme regardless of the configured app origin's
    // own scheme (NEXT_PUBLIC_APP_URL is http:// in this test env, same as local dev) — see
    // `route-matcher.ts`'s header. Only the host has to match `appUrl()`.
    const { question } = await insertGradedQuestionScenario(db);
    const pageUrl = `https://localhost:3000/q/${question.slug}`;
    const res = await oembedGet({ url: pageUrl });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/oembed — profile', () => {
  it('404s for an unknown slug', async () => {
    const res = await oembedGet({ url: '/p/nobody' });
    expect(res.status).toBe(404);
  });

  it('returns a rich oEmbed body for a real profile', async () => {
    const profile = buildProfile();
    await db.insert(profiles).values(profile);
    const res = await oembedGet({ url: `/p/${profile.slug}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe(`${profile.handle}'s receipt`);
    expect(body.thumbnail_url as string).toContain(`/api/og/profile/${profile.slug}?v=`);
  });
});

describe('GET /api/oembed — matchup', () => {
  it('404s for an unknown pairing id', async () => {
    const res = await oembedGet({ url: `/vs/${uuidv7()}` });
    expect(res.status).toBe(404);
  });

  it('returns a rich oEmbed body for a real pairing', async () => {
    const [a, b] = [buildProfile(), buildProfile()];
    await db.insert(profiles).values([a, b]);
    const season = {
      id: uuidv7(),
      kind: 'nemesis' as const,
      startsOn: '2026-01-01',
      endsOn: '2026-03-31',
      name: 'S1',
    };
    await db.insert(seasons).values(season);
    const pairingId = uuidv7();
    await db.insert(nemesisPairings).values({
      id: pairingId,
      seasonId: season.id,
      weekStart: '2026-01-05',
      profileAId: a.id as string,
      profileBId: b.id as string,
      status: 'active',
      scoreA: 2,
      scoreB: 1,
    });

    const res = await oembedGet({ url: `/vs/${pairingId}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe(`${a.handle} vs ${b.handle}`);
  });
});

describe('GET /api/oembed — duo', () => {
  it('404s for an unknown duo id', async () => {
    const res = await oembedGet({ url: `/duos/${uuidv7()}` });
    expect(res.status).toBe(404);
  });

  it('returns a rich oEmbed body for a real duo', async () => {
    const [a, b] = [buildProfile(), buildProfile()];
    await db.insert(profiles).values([a, b]);
    const duoId = uuidv7();
    await db.insert(duos).values({
      id: duoId,
      profileAId: a.id as string,
      profileBId: b.id as string,
      status: 'active',
      tier: 2,
    });

    const res = await oembedGet({ url: `/duos/${duoId}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe(`${a.handle} & ${b.handle}`);
  });
});

describe('GET /api/oembed — format handling and missing url', () => {
  it('missing url= 404s', async () => {
    const res = await oembedGet({});
    expect(res.status).toBe(404);
  });

  it('format=json (explicit) still works', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const res = await oembedGet({ url: `/q/${question.slug}`, format: 'json' });
    expect(res.status).toBe(200);
  });

  it('an unsupported format 404s rather than silently returning json', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const res = await oembedGet({ url: `/q/${question.slug}`, format: 'xml' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/oembed — SSRF rejection end-to-end (route level, not just the pure matcher)', () => {
  it('a foreign host 404s even though the path shape is valid', async () => {
    const res = await oembedGet({ url: 'https://evil.example/q/anything' });
    expect(res.status).toBe(404);
  });

  it('an internal/private-IP-shaped host 404s', async () => {
    const res = await oembedGet({ url: 'https://169.254.169.254/q/anything' });
    expect(res.status).toBe(404);
  });

  it('a non-https scheme to the correct host still 404s', async () => {
    const res = await oembedGet({ url: `http://localhost:3000/q/anything` });
    expect(res.status).toBe(404);
  });

  it('an unmatched path on our own host 404s', async () => {
    const res = await oembedGet({ url: `${APP_ORIGIN}/admin/secret` });
    expect(res.status).toBe(404);
  });
});
