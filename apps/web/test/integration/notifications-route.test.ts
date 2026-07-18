/**
 * WS9-T1 integration: the `sendNotification` web wrapper (getDb()-backed) and the
 * `GET|POST /api/v1/notifications/unsubscribe` route end-to-end, against real Postgres.
 * Mirrors `events.test.ts`'s pattern for exercising a `getDb()`-singleton-backed route: point
 * `DATABASE_URL` at the migrated test instance, then dynamically import the route module.
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

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const SECRET = 'integration-test-unsub-secret-route';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });

  process.env.DATABASE_URL = dbUrl;
  process.env.UNSUB_TOKEN_SECRET = SECRET;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE notifications, profiles, users RESTART IDENTITY CASCADE`);
});

async function makeClaimedProfile(settings: Record<string, unknown> = {}) {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com` });
  const profile = buildProfile({ kind: 'claimed', userId, settings });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

describe('sendNotification (apps/web wrapper)', () => {
  it('inserts a queued row via the getDb() singleton, matching the documented signature order', async () => {
    const { sendNotification } = await import('../../lib/notifications/send-notification.js');
    const profileId = await makeClaimedProfile();

    const result = await sendNotification(
      profileId,
      'reveal',
      { line: 'Reveal is in' },
      'email',
      `reveal:2026-07-19:${profileId}`,
    );
    expect(result.inserted).toBe(true);

    const rows = await db.execute(sql`SELECT status, kind, channel FROM notifications WHERE id = ${result.id}`);
    expect(rows.rows[0]).toMatchObject({ status: 'queued', kind: 'reveal', channel: 'email' });
  });
});

describe('GET|POST /api/v1/notifications/unsubscribe (§13.2)', () => {
  it('GET with a valid token flips the setting and returns 200', async () => {
    const profileId = await makeClaimedProfile({ notifications: { email_duo: true } });
    const token = signUnsubscribeToken({ profileId, category: 'duo' }, SECRET);

    const { GET } = await import('../../app/api/v1/notifications/unsubscribe/route.js');
    const response = await GET(
      new Request(`http://localhost/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { unsubscribed: string } };
    expect(json.data.unsubscribed).toBe('email_duo');

    const rows = await db.execute(sql`SELECT settings FROM profiles WHERE id = ${profileId}`);
    const settings = rows.rows[0]!['settings'] as { notifications: Record<string, boolean> };
    expect(settings.notifications['email_duo']).toBe(false);
  });

  it('POST behaves identically to GET (RFC 8058 one-click)', async () => {
    const profileId = await makeClaimedProfile({ notifications: { email_reveal: true } });
    const token = signUnsubscribeToken({ profileId, category: 'reveal' }, SECRET);

    const { POST } = await import('../../app/api/v1/notifications/unsubscribe/route.js');
    const response = await POST(
      new Request(`http://localhost/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);

    const rows = await db.execute(sql`SELECT settings FROM profiles WHERE id = ${profileId}`);
    const settings = rows.rows[0]!['settings'] as { notifications: Record<string, boolean> };
    expect(settings.notifications['email_reveal']).toBe(false);
  });

  it('missing token → 400 VALIDATION_FAILED', async () => {
    const { GET } = await import('../../app/api/v1/notifications/unsubscribe/route.js');
    const response = await GET(new Request('http://localhost/api/v1/notifications/unsubscribe'));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_FAILED');
  });

  it('forged token → 400 VALIDATION_FAILED, no profile mutated', async () => {
    const profileId = await makeClaimedProfile({ notifications: { email_nemesis: true } });
    const { GET } = await import('../../app/api/v1/notifications/unsubscribe/route.js');
    const response = await GET(
      new Request('http://localhost/api/v1/notifications/unsubscribe?token=forged.garbage'),
    );
    expect(response.status).toBe(400);

    const rows = await db.execute(sql`SELECT settings FROM profiles WHERE id = ${profileId}`);
    const settings = rows.rows[0]!['settings'] as { notifications: Record<string, boolean> };
    expect(settings.notifications['email_nemesis']).toBe(true); // unchanged
  });

  it('works cross-origin (no Origin header) — this route is intentionally not same-origin-gated', async () => {
    const profileId = await makeClaimedProfile();
    const token = signUnsubscribeToken({ profileId, category: 'product' }, SECRET);
    const { POST } = await import('../../app/api/v1/notifications/unsubscribe/route.js');
    const response = await POST(
      new Request(`http://localhost/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { origin: 'https://mail.google.com' },
      }),
    );
    expect(response.status).toBe(200);
  });
});
