/**
 * `buildMeResponse` (design doc §9.2 `GET /me`; see `@/lib/get-me.ts` for why WS7-T5 owns this
 * route) against a real Postgres — mirrors `test/integration/claim-flow.test.ts`'s setup.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, getProfileById, profiles, users, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { buildMeResponse } from '@/lib/get-me';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

describe('buildMeResponse (§9.2 GET /me)', () => {
  it('throws UNAUTHENTICATED for an anonymous visitor', async () => {
    await expect(buildMeResponse(db, { kind: 'anonymous' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('returns a ghost profile with eligibility below threshold and claim.claimed=false', async () => {
    const ghost = buildProfile({ kind: 'ghost', currentStreak: 3, handle: 'Fox #4821' });
    await db.insert(profiles).values(ghost);
    const row = await getProfileById(db, ghost.id as string);
    if (!row) throw new Error('fixture insert failed');

    const result = await buildMeResponse(db, { kind: 'ghost', profile: row });

    expect(result.profile.handle).toBe('Fox #4821');
    expect(result.profile.streak.current).toBe(3);
    expect(result.claim.claimed).toBe(false);
    expect(result.eligibility.graded_picks).toBe(0);
    expect(result.eligibility.nemesis_eligible).toBe(false);
    expect(result.eligibility.duo_eligible).toBe(false);
    expect(result.eligibility.nemesis_required).toBe(5);
    expect(result.eligibility.duo_required).toBe(10);
    expect(result.settings).toEqual({
      nemesis_paused: false,
      show_wallet_address: false,
      notifications: {
        email_reveal: true,
        email_nemesis: true,
        email_duo: true,
        email_product: false,
        push_reveal: true,
        push_nemesis: true,
        push_duo: true,
      },
    });
  });

  it('returns claim.claimed=true for a claimed profile', async () => {
    const userId = uuidv7();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` });
    const claimed = buildProfile({ kind: 'claimed', userId });
    await db.insert(profiles).values(claimed);
    const row = await getProfileById(db, claimed.id as string);
    if (!row) throw new Error('fixture insert failed');

    const result = await buildMeResponse(db, { kind: 'claimed', profile: row, userId });
    expect(result.claim.claimed).toBe(true);
  });
});
