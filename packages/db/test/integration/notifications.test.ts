/**
 * WS9-T1 integration: `notifications` outbox repository against a real Postgres (§5.6, §13.2).
 * Covers the AC that lives at THIS layer — dedupe_key collisions are a silent no-op, only one
 * row survives. The opt-out/quiet-hours ACs are `notify:dispatch` behavior and are covered in
 * `apps/worker/test/integration/notify-dispatch.test.ts`.
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
  getEmailRecipientForNotification,
  listDueQueuedEmailNotifications,
  listSentEmailKindsSince,
  markNotificationCancelled,
  markNotificationFailed,
  markNotificationSent,
  rescheduleNotification,
  sendNotification,
} from '../../src/repositories/notifications.js';

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
  await db.execute(sql`TRUNCATE notifications, profiles, users RESTART IDENTITY CASCADE`);
});

async function makeClaimedProfile(overrides: { email?: string; timezone?: string } = {}) {
  const userId = uuidv7();
  const email = overrides.email ?? `${userId}@example.com`;
  await db.insert(users).values({ id: userId, email, emailVerified: new Date() });
  const profile = buildProfile({
    kind: 'claimed',
    userId,
    timezone: overrides.timezone ?? null,
  });
  await db.insert(profiles).values(profile);
  return { userId, profileId: profile.id as string, email };
}

describe('sendNotification — dedupe_key AC (§5.6, §19.3 WS9-T1)', () => {
  it('two inserts with the same dedupe_key: only one row survives / one send is possible', async () => {
    const { profileId } = await makeClaimedProfile();
    const dedupeKey = `reveal:2026-07-19:${profileId}`;

    const first = await sendNotification(
      db,
      profileId,
      'reveal',
      { line: 'Reveal is in.' },
      'email',
      dedupeKey,
    );
    const second = await sendNotification(
      db,
      profileId,
      'reveal',
      { line: 'Reveal is in (retry).' },
      'email',
      dedupeKey,
    );

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id); // second call resolves back to the original row

    const rows = await db.execute(
      sql`SELECT id, payload FROM notifications WHERE dedupe_key = ${dedupeKey}`,
    );
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { payload: { line: string } }).payload.line).toBe('Reveal is in.');
  });

  it('does NOT throw on a colliding dedupe_key — silent no-op, not an error', async () => {
    const { profileId } = await makeClaimedProfile();
    const dedupeKey = `nemesis_assigned:week1:${profileId}`;
    await sendNotification(db, profileId, 'nemesis_assigned', {}, 'email', dedupeKey);
    await expect(
      sendNotification(db, profileId, 'nemesis_assigned', {}, 'email', dedupeKey),
    ).resolves.not.toThrow();
  });

  it('rows with a NULL dedupe_key never collide with each other', async () => {
    const { profileId } = await makeClaimedProfile();
    const a = await sendNotification(db, profileId, 'streak_milestone', {}, 'email', null);
    const b = await sendNotification(db, profileId, 'streak_milestone', {}, 'email', null);
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
});

describe('listDueQueuedEmailNotifications', () => {
  it('returns only queued, email-channel rows whose scheduled_at has arrived, oldest first', async () => {
    const { profileId } = await makeClaimedProfile();
    const at = new Date('2026-07-19T12:00:00Z');

    const due1 = await sendNotification(db, profileId, 'reveal', {}, 'email', 'k1', new Date(at.getTime() - 60_000));
    const due2 = await sendNotification(db, profileId, 'reveal', {}, 'email', 'k2', new Date(at.getTime() - 30_000));
    await sendNotification(db, profileId, 'reveal', {}, 'email', 'k3', new Date(at.getTime() + 60_000)); // not due yet
    await sendNotification(db, profileId, 'reveal', {}, 'push', 'k4', new Date(at.getTime() - 60_000)); // push, not email

    const due = await listDueQueuedEmailNotifications(db, at, 50);
    expect(due.map((r) => r.id)).toEqual([due1.id, due2.id]);
  });

  it('excludes non-queued rows', async () => {
    const { profileId } = await makeClaimedProfile();
    const at = new Date('2026-07-19T12:00:00Z');
    const n = await sendNotification(db, profileId, 'reveal', {}, 'email', 'kx', new Date(at.getTime() - 60_000));
    await markNotificationSent(db, n.id, at);

    const due = await listDueQueuedEmailNotifications(db, at, 50);
    expect(due.map((r) => r.id)).not.toContain(n.id);
  });
});

describe('rescheduleNotification / markNotification*', () => {
  it('reschedule keeps status queued but changes scheduled_at', async () => {
    const { profileId } = await makeClaimedProfile();
    const n = await sendNotification(db, profileId, 'streak_milestone', {}, 'email');
    const newTime = new Date('2026-07-20T12:00:00Z');
    await rescheduleNotification(db, n.id, newTime);

    const rows = await db.execute(sql`SELECT status, scheduled_at FROM notifications WHERE id = ${n.id}`);
    expect(rows.rows[0]!['status']).toBe('queued');
    expect(new Date(rows.rows[0]!['scheduled_at'] as string).toISOString()).toBe(newTime.toISOString());
  });

  it('markNotificationCancelled/Failed/Sent set the expected terminal status', async () => {
    const { profileId } = await makeClaimedProfile();
    const cancelled = await sendNotification(db, profileId, 'streak_milestone', {}, 'email');
    await markNotificationCancelled(db, cancelled.id);
    const failed = await sendNotification(db, profileId, 'streak_milestone', {}, 'email');
    await markNotificationFailed(db, failed.id);
    const sent = await sendNotification(db, profileId, 'streak_milestone', {}, 'email');
    await markNotificationSent(db, sent.id, new Date());

    const rows = await db.execute(
      sql`SELECT id, status, sent_at FROM notifications WHERE id IN (${cancelled.id}, ${failed.id}, ${sent.id})`,
    );
    const byId = new Map(rows.rows.map((r) => [r['id'] as string, r]));
    expect(byId.get(cancelled.id)!['status']).toBe('cancelled');
    expect(byId.get(failed.id)!['status']).toBe('failed');
    expect(byId.get(sent.id)!['status']).toBe('sent');
    expect(byId.get(sent.id)!['sent_at']).not.toBeNull();
  });
});

describe('listSentEmailKindsSince', () => {
  it('only returns sent, email-channel kinds at/after the given instant', async () => {
    const { profileId } = await makeClaimedProfile();
    const early = await sendNotification(db, profileId, 'streak_milestone', {}, 'email', 'e1');
    await markNotificationSent(db, early.id, new Date('2026-07-19T00:00:00Z'));
    const late = await sendNotification(db, profileId, 'called_it', {}, 'email', 'e2');
    await markNotificationSent(db, late.id, new Date('2026-07-19T12:00:00Z'));
    const unsent = await sendNotification(db, profileId, 'streak_busted', {}, 'email', 'e3');
    void unsent;

    const kinds = await listSentEmailKindsSince(db, profileId, new Date('2026-07-19T06:00:00Z'));
    expect(kinds).toEqual(['called_it']);
  });
});

describe('getEmailRecipientForNotification', () => {
  it('returns email/timezone/settings for a claimed profile with a user email', async () => {
    const { profileId, email } = await makeClaimedProfile({ timezone: 'America/Chicago' });
    const recipient = await getEmailRecipientForNotification(db, profileId);
    expect(recipient).not.toBeNull();
    expect(recipient!.email).toBe(email);
    expect(recipient!.timezone).toBe('America/Chicago');
  });

  it('returns null for a ghost profile (no linked user/email)', async () => {
    const ghost = buildProfile({ kind: 'ghost' });
    await db.insert(profiles).values(ghost);
    const recipient = await getEmailRecipientForNotification(db, ghost.id as string);
    expect(recipient).toBeNull();
  });
});
