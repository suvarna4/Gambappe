/**
 * WS9-T1 integration: `runUnsubscribe` (§13.2 one-click unsubscribe) against a real Postgres.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { signUnsubscribeToken } from '@receipts/core/server';
import { connect, profiles, users, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { runUnsubscribe } from '@/lib/notifications/unsubscribe';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const SECRET = 'integration-test-unsub-secret';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.UNSUB_TOKEN_SECRET = SECRET;
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

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles, users RESTART IDENTITY CASCADE`);
});

async function makeClaimedProfile(settings: Record<string, unknown> = {}) {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com` });
  const profile = buildProfile({ kind: 'claimed', userId, settings });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

describe('runUnsubscribe (§13.2)', () => {
  it('flips email_<category> to false and preserves other settings', async () => {
    const profileId = await makeClaimedProfile({
      nemesis_paused: true,
      notifications: { email_nemesis: true, email_duo: true },
    });
    const token = signUnsubscribeToken({ profileId, category: 'nemesis' }, SECRET);

    const result = await runUnsubscribe(db, token);
    expect(result).toEqual({ status: 'ok', settingKey: 'email_nemesis' });

    const rows = await db.execute(sql`SELECT settings FROM profiles WHERE id = ${profileId}`);
    const settings = rows.rows[0]!['settings'] as {
      nemesis_paused: boolean;
      notifications: Record<string, boolean>;
    };
    expect(settings.notifications['email_nemesis']).toBe(false);
    expect(settings.notifications['email_duo']).toBe(true); // untouched
    expect(settings.nemesis_paused).toBe(true); // untouched, unrelated setting
  });

  it('is idempotent — unsubscribing twice is a no-op the second time, not an error', async () => {
    const profileId = await makeClaimedProfile();
    const token = signUnsubscribeToken({ profileId, category: 'product' }, SECRET);

    await expect(runUnsubscribe(db, token)).resolves.toEqual({ status: 'ok', settingKey: 'email_product' });
    await expect(runUnsubscribe(db, token)).resolves.toEqual({ status: 'ok', settingKey: 'email_product' });
  });

  it('rejects a token signed with the wrong secret', async () => {
    const profileId = await makeClaimedProfile();
    const token = signUnsubscribeToken({ profileId, category: 'reveal' }, 'wrong-secret');
    await expect(runUnsubscribe(db, token)).resolves.toEqual({ status: 'invalid_token' });
  });

  it('returns profile_not_found for a well-signed token whose profile no longer exists', async () => {
    const token = signUnsubscribeToken({ profileId: uuidv7(), category: 'duo' }, SECRET);
    await expect(runUnsubscribe(db, token)).resolves.toEqual({ status: 'profile_not_found' });
  });

  it('rejects a malformed token string without throwing', async () => {
    await expect(runUnsubscribe(db, 'not-a-real-token')).resolves.toEqual({ status: 'invalid_token' });
  });
});
