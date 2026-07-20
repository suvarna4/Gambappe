/**
 * SW10-T4 (wiring-gaps doc §4) integration: `POST /api/v1/reactions` for
 * `context_kind: 'pairing'`, exercised through the REAL route handler (not just the `lib/`
 * function) against real Postgres + Redis — this task's AC is explicit that the ghost-rejection
 * proof must be "against the route, not just via the UI's claim prompt": a direct POST bypassing
 * any client-side gating must still be rejected server-side. Mirrors
 * `rate-limit-routes.test.ts`'s pattern for exercising `getDb()`/`getRedis()`-singleton-backed
 * routes with a mocked `../../auth` (real next-auth can't resolve outside the Next.js runtime
 * under plain vitest, per `identity-request.ts`'s own header note).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, nemesisPairings, profiles, seasons, users, type Db, type ProfileRow } from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';

vi.mock('../../auth', () => ({ auth: vi.fn(async () => null) }));

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
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
    sql`TRUNCATE TABLE pairing_reactions, blocks, notifications, rematch_requests, duo_matches, duos, pairing_questions, nemesis_pairings, ratings, picks, questions, markets, profiles, users, seasons RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
});

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
  return { profileId: profile.id as string, cookie: `${GHOST_COOKIE_NAME}=${buildGhostCookieValue(profile.id as string, secret)}` };
}

async function makeClaimedProfile(): Promise<ProfileRow> {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com` });
  const [row] = await db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active', userId })).returning();
  return row!;
}

async function makeSeasonRow(): Promise<string> {
  const [row] = await db.insert(seasons).values(buildSeason({ startsOn: '2026-07-06', endsOn: '2026-09-28' })).returning();
  return row!.id;
}

async function makePairing(seasonId: string, a: string, b: string): Promise<string> {
  const [row] = await db
    .insert(nemesisPairings)
    .values(buildNemesisPairing(seasonId, a, b, { weekStart: '2026-07-13', status: 'active' }))
    .returning();
  return row!.id;
}

async function postReaction(body: unknown, headers: Record<string, string>) {
  const { POST } = await import('../../app/api/v1/reactions/route.js');
  return POST(
    new Request('http://localhost/api/v1/reactions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/v1/reactions — context_kind: pairing (SW10-T4, real route handler)', () => {
  it('rejects a GHOST session server-side with 401 UNAUTHENTICATED (a direct POST, not via the UI claim prompt)', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id);
    const ghost = await makeGhostWithCookie();

    const res = await postReaction(
      { context_kind: 'pairing', context_id: pairingId, emoji: 'Lucky' },
      mutationHeaders('198.51.100.60', { cookie: ghost.cookie }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()) as never).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects a fully anonymous caller (no session, no ghost cookie) the same way', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    const res = await postReaction(
      { context_kind: 'pairing', context_id: pairingId, emoji: 'Lucky' },
      mutationHeaders('198.51.100.61'),
    );

    expect(res.status).toBe(401);
    expect((await res.json()) as never).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('a claimed participant succeeds end-to-end through the real route: 200 added, reload reflects it', async () => {
    const { auth } = await import('../../auth.js');
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    vi.mocked(auth).mockResolvedValue({ user: { id: a.userId } } as never);

    const res = await postReaction(
      { context_kind: 'pairing', context_id: pairingId, emoji: 'Sweating?' },
      mutationHeaders('198.51.100.62'),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as never).toMatchObject({ data: { state: 'added' } });

    // Same-day repost through the route again — replaces, not a 409.
    const res2 = await postReaction(
      { context_kind: 'pairing', context_id: pairingId, emoji: 'Lucky' },
      mutationHeaders('198.51.100.62'),
    );
    expect(res2.status).toBe(200);
    expect((await res2.json()) as never).toMatchObject({ data: { state: 'replaced' } });

    vi.mocked(auth).mockResolvedValue(null as never);
  });

  it('rejects a request with a rogue non-preset emoji for context_kind: pairing (schema-level, before any DB write)', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id);
    const ghost = await makeGhostWithCookie(); // even a rejected-anyway caller shouldn't get past schema validation first

    const res = await postReaction(
      { context_kind: 'pairing', context_id: pairingId, emoji: '🔥' }, // a REACTION_SET emoji, not a pairing stamp
      mutationHeaders('198.51.100.63', { cookie: ghost.cookie }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as never).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
