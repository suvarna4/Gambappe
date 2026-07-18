/**
 * WS9-T2 integration: `subscribePush`/`unsubscribePush` (the route's lib layer, §13.2) against
 * a real Postgres. Route-level auth/flag gating is thin wrapping tested by inspection, not
 * re-derived here — see other claimed-only routes' (`wallet-flow.ts`, `moderation.ts`) tests
 * for the same split.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, listActivePushSubscriptionsForProfile, profiles, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { subscribePush, unsubscribePush } from '@/lib/push/subscribe-flow';

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

beforeEach(async () => {
  await db.execute(sql`TRUNCATE push_subscriptions, profiles RESTART IDENTITY CASCADE`);
});

async function makeClaimedProfile(): Promise<string> {
  const profile = buildProfile({ kind: 'claimed' });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

describe('subscribePush', () => {
  it('creates an active subscription for the profile', async () => {
    const profileId = await makeClaimedProfile();
    const result = await subscribePush(db, profileId, {
      endpoint: 'https://push.example/flow-1',
      keys: { p256dh: 'p', auth: 'a' },
    });
    expect(result).toEqual({ subscribed: true });

    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active.map((s) => s.endpoint)).toEqual(['https://push.example/flow-1']);
  });

  it('rejects an 11th distinct endpoint once the profile is at the 10-device cap', async () => {
    const profileId = await makeClaimedProfile();
    for (let i = 0; i < 10; i++) {
      await subscribePush(db, profileId, { endpoint: `https://push.example/cap-${i}`, keys: { p256dh: 'p', auth: 'a' } });
    }

    await expect(
      subscribePush(db, profileId, { endpoint: 'https://push.example/cap-11', keys: { p256dh: 'p', auth: 'a' } }),
    ).rejects.toThrow(/too many active push subscriptions/);

    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active).toHaveLength(10);
  });

  it('re-subscribing an already-active endpoint is never blocked by the cap', async () => {
    const profileId = await makeClaimedProfile();
    for (let i = 0; i < 10; i++) {
      await subscribePush(db, profileId, { endpoint: `https://push.example/recap-${i}`, keys: { p256dh: 'p', auth: 'a' } });
    }

    await expect(
      subscribePush(db, profileId, { endpoint: 'https://push.example/recap-0', keys: { p256dh: 'new', auth: 'new' } }),
    ).resolves.toEqual({ subscribed: true });
  });
});

describe('unsubscribePush', () => {
  it('revokes an existing subscription owned by the calling profile', async () => {
    const profileId = await makeClaimedProfile();
    await subscribePush(db, profileId, { endpoint: 'https://push.example/flow-2', keys: { p256dh: 'p', auth: 'a' } });

    const result = await unsubscribePush(db, profileId, 'https://push.example/flow-2', new Date());
    expect(result).toEqual({ unsubscribed: true });

    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active).toHaveLength(0);
  });

  it('is a no-op for an endpoint that was never subscribed', async () => {
    const profileId = await makeClaimedProfile();
    await expect(unsubscribePush(db, profileId, 'https://push.example/never', new Date())).resolves.toEqual({
      unsubscribed: true,
    });
  });

  it('never revokes another profile\'s subscription, even when the endpoint is known', async () => {
    const owner = await makeClaimedProfile();
    const attacker = await makeClaimedProfile();
    await subscribePush(db, owner, { endpoint: 'https://push.example/flow-3', keys: { p256dh: 'p', auth: 'a' } });

    const result = await unsubscribePush(db, attacker, 'https://push.example/flow-3', new Date());
    expect(result).toEqual({ unsubscribed: true }); // reports success either way (no oracle for "does this endpoint exist")

    const active = await listActivePushSubscriptionsForProfile(db, owner);
    expect(active.map((s) => s.endpoint)).toEqual(['https://push.example/flow-3']); // still active — the attacker's call was scoped to their own (empty) profile
  });
});
