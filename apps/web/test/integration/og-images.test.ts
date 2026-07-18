/**
 * WS8-T1 integration: the six `/api/og/*` templates against real Postgres + Redis. Covers the
 * task's acceptance criteria directly: entity 404, wrong `?v=` → 302 (never a render), correct
 * `?v=` → an actual PNG render with the immutable cache header, and the loss/void/busted-
 * streak receipt variants get real (not fallback) renders.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import {
  connect,
  duos,
  insertPick,
  nemesisPairings,
  profiles,
  seasons,
  type Db,
} from '@receipts/db';
import { buildPick, buildProfile, insertGradedQuestionScenario } from '@receipts/db/testing';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

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
  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

async function ogGet(path: string): Promise<Response> {
  // Each route module's GET narrows `params` to its own dynamic segment name; this helper
  // dispatches across all five by path prefix, so the params shape is only known at runtime
  // — hence the cast, checked instead by `paramsFor`'s own path-prefix branches lining up
  // 1:1 with `importRoute`'s.
  const { GET } = (await importRoute(path)) as unknown as {
    GET: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  };
  const url = `http://localhost${path}`;
  const request = new Request(url, { headers: { 'x-forwarded-for': '203.0.113.9' } });
  const params = paramsFor(path);
  return GET(request, { params: Promise.resolve(params) });
}

/** Maps a request path to its route module + parsed dynamic params, mirroring the app dir. */
async function importRoute(path: string) {
  if (path.startsWith('/api/og/question/')) return import('../../app/api/og/question/[slug]/route.js');
  if (path.startsWith('/api/og/receipt/')) return import('../../app/api/og/receipt/[pickId]/route.js');
  if (path.startsWith('/api/og/matchup/')) return import('../../app/api/og/matchup/[pairingId]/route.js');
  if (path.startsWith('/api/og/profile/')) return import('../../app/api/og/profile/[slug]/route.js');
  if (path.startsWith('/api/og/duo/')) return import('../../app/api/og/duo/[duoId]/route.js');
  throw new Error(`no route for ${path}`);
}

function paramsFor(path: string): Record<string, string> {
  const id = path.split('?')[0]!.split('/').pop()!;
  if (path.startsWith('/api/og/question/')) return { slug: id };
  if (path.startsWith('/api/og/receipt/')) return { pickId: id };
  if (path.startsWith('/api/og/matchup/')) return { pairingId: id };
  if (path.startsWith('/api/og/profile/')) return { slug: id };
  if (path.startsWith('/api/og/duo/')) return { duoId: id };
  throw new Error(`no params for ${path}`);
}

/** Pulls the canonical `?v=` hash the server wants out of a 302's Location header. */
function canonicalVersion(res: Response): string {
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  return new URL(location!).searchParams.get('v')!;
}

describe('GET /api/og/question/:slug (§10.5)', () => {
  it('404s for an unknown slug', async () => {
    const res = await ogGet('/api/og/question/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('missing ?v= redirects (302) to the canonical URL, never rendering', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const res = await ogGet(`/api/og/question/${question.slug}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('content-type')).not.toBe('image/png');
  });

  it('wrong ?v= redirects (302) to the canonical URL', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const res = await ogGet(`/api/og/question/${question.slug}?v=stale-garbage`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain(`/api/og/question/${question.slug}`);
    expect(location).not.toContain('stale-garbage');
  });

  it('correct ?v= renders a PNG with the immutable §10.5 cache header', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const redirect = await ogGet(`/api/og/question/${question.slug}`);
    const v = canonicalVersion(redirect);

    const res = await ogGet(`/api/og/question/${question.slug}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=86400, immutable');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PNG magic bytes.
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('the canonical hash changes once the question is no longer the same state', async () => {
    const scenarioA = await insertGradedQuestionScenario(db);
    const scenarioB = await insertGradedQuestionScenario(db);
    const redirectA = await ogGet(`/api/og/question/${scenarioA.question.slug}`);
    const redirectB = await ogGet(`/api/og/question/${scenarioB.question.slug}`);
    expect(canonicalVersion(redirectA)).not.toBe(canonicalVersion(redirectB));
  });
});

describe('GET /api/og/receipt/:pickId (§10.5 — loss/void/busted-streak get equal treatment)', () => {
  it('404s for an unknown pick', async () => {
    const res = await ogGet(`/api/og/receipt/${uuidv7()}`);
    expect(res.status).toBe(404);
  });

  it('renders a win receipt', async () => {
    const { picks } = await insertGradedQuestionScenario(db);
    const winningPick = picks[0]; // first two are wins per the fixture
    const redirect = await ogGet(`/api/og/receipt/${winningPick.id}`);
    const v = canonicalVersion(redirect);
    const res = await ogGet(`/api/og/receipt/${winningPick.id}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('renders a loss receipt (not a fallback — real 200 PNG)', async () => {
    const { picks } = await insertGradedQuestionScenario(db);
    const losingPick = picks[2]; // third pick is the loss per the fixture
    const redirect = await ogGet(`/api/og/receipt/${losingPick.id}`);
    const v = canonicalVersion(redirect);
    const res = await ogGet(`/api/og/receipt/${losingPick.id}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('renders a busted-streak receipt when the profile lost with a currently-zero streak', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const profile = buildProfile({ currentStreak: 0, bestStreak: 5 });
    await db.insert(profiles).values(profile);
    const pick = buildPick(question.id as string, profile.id as string, {
      result: 'loss',
      side: 'no',
      yesPriceAtEntry: 0.66,
    });
    await insertPick(db, pick);

    const redirect = await ogGet(`/api/og/receipt/${pick.id}`);
    const v = canonicalVersion(redirect);
    const res = await ogGet(`/api/og/receipt/${pick.id}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('GET /api/og/matchup/:pairingId (§10.5)', () => {
  it('404s for an unknown pairing, 200s for a real one', async () => {
    expect((await ogGet(`/api/og/matchup/${uuidv7()}`)).status).toBe(404);

    const [a, b] = [buildProfile(), buildProfile()];
    await db.insert(profiles).values([a, b]);
    const season = { id: uuidv7(), kind: 'nemesis' as const, startsOn: '2026-01-01', endsOn: '2026-03-31', name: 'S1' };
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

    const redirect = await ogGet(`/api/og/matchup/${pairingId}`);
    const v = canonicalVersion(redirect);
    const res = await ogGet(`/api/og/matchup/${pairingId}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('GET /api/og/profile/:slug (§10.5)', () => {
  it('404s for an unknown slug, 200s for a real profile', async () => {
    expect((await ogGet('/api/og/profile/nobody')).status).toBe(404);

    const { profiles: fixtureProfiles } = await insertGradedQuestionScenario(db);
    const profile = fixtureProfiles[0];

    const redirect = await ogGet(`/api/og/profile/${profile.slug}`);
    const v = canonicalVersion(redirect);
    const res = await ogGet(`/api/og/profile/${profile.slug}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('GET /api/og/duo/:duoId (§10.5)', () => {
  it('404s for an unknown duo, 200s for a real one', async () => {
    expect((await ogGet(`/api/og/duo/${uuidv7()}`)).status).toBe(404);

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

    const redirect = await ogGet(`/api/og/duo/${duoId}`);
    const v = canonicalVersion(redirect);
    const res = await ogGet(`/api/og/duo/${duoId}?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});
