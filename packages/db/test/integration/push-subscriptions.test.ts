/**
 * WS9-T2 integration: `push_subscriptions` repository against a real Postgres (§5.6, §13.2).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { profiles, users } from '../../src/schema/index.js';
import { buildProfile } from '../../src/testing/factories.js';
import {
  listActivePushSubscriptionsForProfile,
  revokePushSubscriptionByEndpoint,
  revokePushSubscriptionByEndpointForProfile,
  upsertPushSubscription,
} from '../../src/repositories/push-subscriptions.js';

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
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE push_subscriptions, profiles, users RESTART IDENTITY CASCADE`);
});

async function makeClaimedProfile() {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: new Date() });
  const profile = buildProfile({ kind: 'claimed', userId });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

describe('upsertPushSubscription', () => {
  it('inserts a new subscription', async () => {
    const profileId = await makeClaimedProfile();
    const row = await upsertPushSubscription(db, profileId, 'https://push.example/ep-1', {
      p256dh: 'p256dh-1',
      auth: 'auth-1',
    });
    expect(row.profileId).toBe(profileId);
    expect(row.endpoint).toBe('https://push.example/ep-1');
    expect(row.revokedAt).toBeNull();
  });

  it('re-subscribing the same endpoint updates keys/profile and un-revokes it', async () => {
    const profileA = await makeClaimedProfile();
    const profileB = await makeClaimedProfile();
    const endpoint = 'https://push.example/ep-shared';

    await upsertPushSubscription(db, profileA, endpoint, { p256dh: 'old', auth: 'old' });
    await revokePushSubscriptionByEndpoint(db, endpoint, new Date());

    const updated = await upsertPushSubscription(db, profileB, endpoint, { p256dh: 'new', auth: 'new' });
    expect(updated.profileId).toBe(profileB);
    expect(updated.keys).toEqual({ p256dh: 'new', auth: 'new' });
    expect(updated.revokedAt).toBeNull();

    const active = await listActivePushSubscriptionsForProfile(db, profileB);
    expect(active).toHaveLength(1);
  });
});

describe('revokePushSubscriptionByEndpoint', () => {
  it('is idempotent for an unknown endpoint (silent no-op)', async () => {
    await expect(
      revokePushSubscriptionByEndpoint(db, 'https://push.example/never-existed', new Date()),
    ).resolves.toBeUndefined();
  });

  it('removes the endpoint from the active list once revoked', async () => {
    const profileId = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/ep-2', { p256dh: 'a', auth: 'b' });

    await revokePushSubscriptionByEndpoint(db, 'https://push.example/ep-2', new Date());

    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active).toHaveLength(0);
  });
});

describe('revokePushSubscriptionByEndpointForProfile', () => {
  it('revokes when the endpoint belongs to the given profile', async () => {
    const profileId = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/owned', { p256dh: 'a', auth: 'b' });

    await revokePushSubscriptionByEndpointForProfile(db, profileId, 'https://push.example/owned', new Date());

    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active).toHaveLength(0);
  });

  it('does NOT revoke an endpoint owned by a different profile', async () => {
    const owner = await makeClaimedProfile();
    const attacker = await makeClaimedProfile();
    await upsertPushSubscription(db, owner, 'https://push.example/not-yours', { p256dh: 'a', auth: 'b' });

    await revokePushSubscriptionByEndpointForProfile(db, attacker, 'https://push.example/not-yours', new Date());

    const active = await listActivePushSubscriptionsForProfile(db, owner);
    expect(active.map((s) => s.endpoint)).toEqual(['https://push.example/not-yours']);
  });

  it('is idempotent for an unknown endpoint (silent no-op)', async () => {
    const profileId = await makeClaimedProfile();
    await expect(
      revokePushSubscriptionByEndpointForProfile(db, profileId, 'https://push.example/never-existed', new Date()),
    ).resolves.toBeUndefined();
  });
});

describe('listActivePushSubscriptionsForProfile', () => {
  it('returns every active subscription across multiple devices, excluding revoked ones', async () => {
    const profileId = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/device-1', { p256dh: 'a', auth: 'b' });
    await upsertPushSubscription(db, profileId, 'https://push.example/device-2', { p256dh: 'c', auth: 'd' });
    await upsertPushSubscription(db, profileId, 'https://push.example/device-3', { p256dh: 'e', auth: 'f' });
    await revokePushSubscriptionByEndpoint(db, 'https://push.example/device-3', new Date());

    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active.map((s) => s.endpoint).sort()).toEqual([
      'https://push.example/device-1',
      'https://push.example/device-2',
    ]);
  });
});
