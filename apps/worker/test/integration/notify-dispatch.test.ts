/**
 * WS9-T1/WS9-T2 integration ACs (§19.3): `notify:dispatch` against a real Postgres.
 *
 *  - dedupe_key prevents double-send: two `sendNotification` calls with the same key leave one
 *    row, so at most one send happens (repo-layer dedupe is covered in depth by
 *    `packages/db/test/integration/notifications.test.ts`; this file re-asserts it end-to-end
 *    through `runNotifyDispatch`).
 *  - opt-out honored: a profile with `email_nemesis: false` never gets a nemesis-kind email.
 *  - quiet-hours deferral: a notification scheduled at 23:00 local is deferred to 08:00, not
 *    sent immediately.
 *  - (WS9-T2) push: no-subscription cancellation, opt-out, multi-device fan-out, and
 *    revocation-on-410 all run through `runPushNotifyDispatch` against real subscription rows.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import PgBoss from 'pg-boss';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  listActivePushSubscriptionsForProfile,
  profiles,
  sendNotification,
  upsertPushSubscription,
  users,
  type Db,
} from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import type { JobContext } from '../../src/context.js';
import { LoggingEmailTransport } from '@receipts/core/server';
import { LoggingPushTransport, type PushTransport, type PushSendResult } from '../../src/lib/push-transport.js';
import { notifyDispatchHandler, runNotifyDispatch, runPushNotifyDispatch } from '../../src/jobs/notify-dispatch.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;
let boss: PgBoss;
let redis: Redis;

beforeAll(async () => {
  process.env.UNSUB_TOKEN_SECRET = 'integration-test-unsub-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://receipts.example';
  delete process.env.RESEND_API_KEY; // ensure defaultEmailTransport() isn't relevant here — we inject LoggingEmailTransport directly

  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });

  boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
  await boss.start();
  await boss.createQueue('notify:dispatch');

  // Never actually used by notify:dispatch (it does no Redis I/O) — lazyConnect keeps this
  // from needing a live Redis just to satisfy JobContext's shape for the handler-wrapper test.
  redis = new Redis('redis://localhost:6379', { lazyConnect: true });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  redis.disconnect();
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE notifications, push_subscriptions, profiles, users RESTART IDENTITY CASCADE`);
});

async function makeClaimedProfile(opts: {
  email?: string;
  timezone?: string | null;
  settings?: Record<string, unknown>;
} = {}) {
  const userId = uuidv7();
  const email = opts.email ?? `${userId}@example.com`;
  await db.insert(users).values({ id: userId, email, emailVerified: new Date() });
  const profile = buildProfile({
    kind: 'claimed',
    userId,
    timezone: opts.timezone ?? null,
    settings: opts.settings ?? {},
  });
  await db.insert(profiles).values(profile);
  return { userId, profileId: profile.id as string, email };
}

describe('runNotifyDispatch — dedupe_key AC (§19.3)', () => {
  it('two sendNotification calls with the same dedupe_key result in exactly one send', async () => {
    const { profileId, email } = await makeClaimedProfile();
    const at = new Date('2026-07-19T15:00:00Z'); // 11:00 ET — awake hours
    const dedupeKey = `reveal:2026-07-19:${profileId}`;

    await sendNotification(db, profileId, 'reveal', { line: 'Reveal 1' }, 'email', dedupeKey, at);
    await sendNotification(db, profileId, 'reveal', { line: 'Reveal 2 (dup)' }, 'email', dedupeKey, at);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(1);
    expect(transport.getLastEmail(email)?.text).toContain('Reveal 1');

    const rows = await db.execute(sql`SELECT status FROM notifications WHERE dedupe_key = ${dedupeKey}`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!['status']).toBe('sent');
  });
});

describe('runNotifyDispatch — opt-out AC (§19.3, §9.4)', () => {
  it('a profile with email_nemesis=false never gets a nemesis-kind email', async () => {
    const { profileId, email } = await makeClaimedProfile({
      settings: { notifications: { email_nemesis: false } },
    });
    const at = new Date('2026-07-19T15:00:00Z'); // 11:00 ET — awake hours

    await sendNotification(db, profileId, 'nemesis_lead_taken', { line: 'x' }, 'email', 'n1', at);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(0);
    expect(report.cancelledOptOut).toBe(1);
    expect(transport.getLastEmail(email)).toBeUndefined();

    const rows = await db.execute(sql`SELECT status FROM notifications WHERE dedupe_key = 'n1'`);
    expect(rows.rows[0]!['status']).toBe('cancelled');
  });

  it('a profile that only opted out of email_duo still gets a nemesis email', async () => {
    const { profileId, email } = await makeClaimedProfile({
      settings: { notifications: { email_duo: false } },
    });
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'nemesis_lead_taken', { line: 'x' }, 'email', 'n2', at);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(1);
    expect(transport.getLastEmail(email)).toBeDefined();
  });
});

describe('runNotifyDispatch — quiet-hours deferral AC (§19.3, §13.2)', () => {
  it('a notification scheduled at 23:00 local is deferred to 08:00, not sent immediately', async () => {
    const { profileId, email } = await makeClaimedProfile({
      timezone: 'America/New_York',
      settings: { notifications: { email_product: true } }, // streak_milestone is "product" category (§13.2) — opt in so quiet-hours (not opt-out) is what's under test
    });
    const at2300ET = new Date('2026-07-20T03:00:00Z'); // 23:00 EDT on 2026-07-19

    await sendNotification(db, profileId, 'streak_milestone', { line: 'x' }, 'email', 'q1', at2300ET);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at2300ET);

    expect(report.sent).toBe(0);
    expect(report.deferredQuietHours).toBe(1);
    expect(transport.getLastEmail(email)).toBeUndefined();

    const rows = await db.execute(sql`SELECT status, scheduled_at FROM notifications WHERE dedupe_key = 'q1'`);
    expect(rows.rows[0]!['status']).toBe('queued'); // still queued, just rescheduled
    expect(new Date(rows.rows[0]!['scheduled_at'] as string).toISOString()).toBe('2026-07-20T12:00:00.000Z'); // 08:00 EDT
  });

  it('reveal-kind notifications are exempt from quiet-hours deferral', async () => {
    const { profileId, email } = await makeClaimedProfile({ timezone: 'America/New_York' });
    const at2300ET = new Date('2026-07-20T03:00:00Z');
    await sendNotification(db, profileId, 'reveal', { line: 'Reveal is in' }, 'email', 'q2', at2300ET);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at2300ET);

    expect(report.sent).toBe(1);
    expect(transport.getLastEmail(email)).toBeDefined();
  });

  it('a rescheduled notification IS sent once its new scheduled_at arrives', async () => {
    const { profileId, email } = await makeClaimedProfile({
      timezone: 'America/New_York',
      settings: { notifications: { email_product: true } },
    });
    const at2300ET = new Date('2026-07-20T03:00:00Z');
    await sendNotification(db, profileId, 'streak_milestone', { line: 'x' }, 'email', 'q3', at2300ET);

    const firstTransport = new LoggingEmailTransport();
    await runNotifyDispatch(db, firstTransport, at2300ET);
    expect(firstTransport.getLastEmail(email)).toBeUndefined();

    const at0800ET = new Date('2026-07-20T12:00:00Z'); // the deferred target
    const secondTransport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, secondTransport, at0800ET);
    expect(report.sent).toBe(1);
    expect(secondTransport.getLastEmail(email)).toBeDefined();
  });
});

describe('runNotifyDispatch — marketing daily cap (§13.2)', () => {
  it('a second non-transactional email the same local day is deferred, not sent', async () => {
    const { profileId, email } = await makeClaimedProfile({
      timezone: 'America/New_York',
      settings: { notifications: { email_product: true } },
    });
    const at = new Date('2026-07-19T15:00:00Z'); // 11:00 ET

    await sendNotification(db, profileId, 'streak_milestone', { line: 'first' }, 'email', 'm1', at);
    await sendNotification(db, profileId, 'called_it', { line: 'second' }, 'email', 'm2', at);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(1);
    expect(report.deferredMarketingCap).toBe(1);
    expect(transport.getLastEmail(email)?.text).toContain('first');
  });

  it('a transactional (nemesis/duo/reveal) email is exempt from the cap', async () => {
    const { profileId, email } = await makeClaimedProfile({
      timezone: 'America/New_York',
      settings: { notifications: { email_product: true } },
    });
    const at = new Date('2026-07-19T15:00:00Z');

    await sendNotification(db, profileId, 'streak_milestone', { line: 'product email' }, 'email', 'x1', at);
    const first = new LoggingEmailTransport();
    const firstReport = await runNotifyDispatch(db, first, at);
    expect(firstReport.sent).toBe(1); // confirms the "already sent one marketing email today" premise actually holds

    await sendNotification(db, profileId, 'nemesis_lead_taken', { line: 'nemesis email' }, 'email', 'x2', at);
    const second = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, second, at);

    expect(report.sent).toBe(1);
    expect(second.getLastEmail(email)?.text).toContain('nemesis email');
  });
});

describe('runNotifyDispatch — no recipient', () => {
  it('a ghost profile (no linked user/email) is marked failed, not sent', async () => {
    const ghost = buildProfile({ kind: 'ghost' });
    await db.insert(profiles).values(ghost);
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, ghost.id as string, 'streak_milestone', { line: 'x' }, 'email', 'g1', at);

    const transport = new LoggingEmailTransport();
    const report = await runNotifyDispatch(db, transport, at);
    expect(report.sent).toBe(0);
    expect(report.failed).toBe(1);

    const rows = await db.execute(sql`SELECT status FROM notifications WHERE dedupe_key = 'g1'`);
    expect(rows.rows[0]!['status']).toBe('failed');
  });
});

describe('runPushNotifyDispatch — no subscription (§19.3, WS9-T2)', () => {
  it('a profile with no active push subscription is cancelled, not failed', async () => {
    const { profileId } = await makeClaimedProfile();
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'reveal', { line: 'x' }, 'push', 'p1', at);

    const transport = new LoggingPushTransport();
    const report = await runPushNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(0);
    expect(report.cancelledNoSubscription).toBe(1);
    const rows = await db.execute(sql`SELECT status FROM notifications WHERE dedupe_key = 'p1'`);
    expect(rows.rows[0]!['status']).toBe('cancelled');
  });
});

describe('runPushNotifyDispatch — opt-out AC (§19.3, §9.4)', () => {
  it('a profile with push_nemesis=false never gets a nemesis-kind push', async () => {
    const { profileId } = await makeClaimedProfile({
      settings: { notifications: { push_nemesis: false } },
    });
    await upsertPushSubscription(db, profileId, 'https://push.example/opt-out', { p256dh: 'p', auth: 'a' });
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'nemesis_lead_taken', { line: 'x' }, 'push', 'p2', at);

    const transport = new LoggingPushTransport();
    const report = await runPushNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(0);
    expect(report.cancelledOptOut).toBe(1);
    expect(transport.getLastPush('https://push.example/opt-out')).toBeUndefined();
  });

  it('the product category (no push_product setting) never sends', async () => {
    const { profileId } = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/product', { p256dh: 'p', auth: 'a' });
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'streak_milestone', { line: 'x' }, 'push', 'p3', at);

    const transport = new LoggingPushTransport();
    const report = await runPushNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(0);
    expect(report.cancelledOptOut).toBe(1);
  });
});

describe('runPushNotifyDispatch — quiet hours (§13.2)', () => {
  it('a non-reveal push scheduled at 23:00 local is deferred to 08:00', async () => {
    const { profileId } = await makeClaimedProfile({ timezone: 'America/New_York' });
    await upsertPushSubscription(db, profileId, 'https://push.example/quiet', { p256dh: 'p', auth: 'a' });
    const at2300ET = new Date('2026-07-20T03:00:00Z');
    await sendNotification(db, profileId, 'nemesis_lead_taken', { line: 'x' }, 'push', 'p4', at2300ET);

    const transport = new LoggingPushTransport();
    const report = await runPushNotifyDispatch(db, transport, at2300ET);

    expect(report.sent).toBe(0);
    expect(report.deferredQuietHours).toBe(1);
    expect(transport.getLastPush('https://push.example/quiet')).toBeUndefined();
  });

  it('reveal-kind push is exempt from quiet-hours deferral', async () => {
    const { profileId } = await makeClaimedProfile({ timezone: 'America/New_York' });
    await upsertPushSubscription(db, profileId, 'https://push.example/reveal-exempt', { p256dh: 'p', auth: 'a' });
    const at2300ET = new Date('2026-07-20T03:00:00Z');
    await sendNotification(db, profileId, 'reveal', { line: 'Reveal is in' }, 'push', 'p5', at2300ET);

    const transport = new LoggingPushTransport();
    const report = await runPushNotifyDispatch(db, transport, at2300ET);

    expect(report.sent).toBe(1);
    expect(transport.getLastPush('https://push.example/reveal-exempt')?.body).toBe('Reveal is in');
  });
});

describe('runPushNotifyDispatch — multi-device fan-out + revocation (§5.6, WS9-T2)', () => {
  /** Scripted per-endpoint outcomes — lets a single test drive one device to a 410 (revoked)
   * and another to a normal success, which `LoggingPushTransport` alone can't express. */
  class ScriptedPushTransport implements PushTransport {
    public readonly sent: string[] = [];
    constructor(private readonly outcomes: Record<string, PushSendResult | 'throw'>) {}
    async send(push: Parameters<PushTransport['send']>[0]): Promise<PushSendResult> {
      const outcome = this.outcomes[push.subscription.endpoint] ?? { revoked: false };
      if (outcome === 'throw') throw new Error('transient failure');
      this.sent.push(push.subscription.endpoint);
      return outcome;
    }
  }

  it('sends to every active device and marks the row sent if at least one succeeds', async () => {
    const { profileId } = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/multi-1', { p256dh: 'p', auth: 'a' });
    await upsertPushSubscription(db, profileId, 'https://push.example/multi-2', { p256dh: 'p', auth: 'a' });
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'reveal', { line: 'x' }, 'push', 'p6', at);

    const transport = new ScriptedPushTransport({});
    const report = await runPushNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(1);
    expect(transport.sent.sort()).toEqual(['https://push.example/multi-1', 'https://push.example/multi-2']);
  });

  it('revokes a device that returns 404/410-derived revoked:true, independent of the row outcome', async () => {
    const { profileId } = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/good', { p256dh: 'p', auth: 'a' });
    await upsertPushSubscription(db, profileId, 'https://push.example/gone', { p256dh: 'p', auth: 'a' });
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'reveal', { line: 'x' }, 'push', 'p7', at);

    const transport = new ScriptedPushTransport({ 'https://push.example/gone': { revoked: true } });
    const report = await runPushNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(1); // the good device still got it
    const active = await listActivePushSubscriptionsForProfile(db, profileId);
    expect(active.map((s) => s.endpoint)).toEqual(['https://push.example/good']);
  });

  it('marks the row failed when every device errors', async () => {
    const { profileId } = await makeClaimedProfile();
    await upsertPushSubscription(db, profileId, 'https://push.example/fails', { p256dh: 'p', auth: 'a' });
    const at = new Date('2026-07-19T15:00:00Z');
    await sendNotification(db, profileId, 'reveal', { line: 'x' }, 'push', 'p8', at);

    const transport = new ScriptedPushTransport({ 'https://push.example/fails': 'throw' });
    const report = await runPushNotifyDispatch(db, transport, at);

    expect(report.sent).toBe(0);
    expect(report.failed).toBe(1);
    const rows = await db.execute(sql`SELECT status FROM notifications WHERE dedupe_key = 'p8'`);
    expect(rows.rows[0]!['status']).toBe('failed');
  });
});

describe('notifyDispatchHandler — 30s self-requeue (§7.6 "every 30s", registry.ts header note)', () => {
  it('a cron-triggered run (no selfRequeue flag) self-requeues one follow-up run 30s out', async () => {
    const ctx: JobContext = { db, pool, boss, redis };
    await notifyDispatchHandler(ctx, undefined);

    const jobs = await db.execute(
      sql`SELECT data, singleton_key, EXTRACT(EPOCH FROM (start_after - now())) AS seconds_out
          FROM pgboss.job WHERE name = 'notify:dispatch' ORDER BY created_on DESC LIMIT 1`,
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]!['data']).toEqual({ selfRequeue: true });
    expect(jobs.rows[0]!['singleton_key']).toBe('notify-dispatch-tick');
    expect(Number(jobs.rows[0]!['seconds_out'])).toBeGreaterThan(20); // ~30s out, allow test-runtime slack
  });

  it('a self-requeued run (selfRequeue: true) does NOT schedule a further follow-up', async () => {
    await db.execute(sql`DELETE FROM pgboss.job WHERE name = 'notify:dispatch'`);
    const ctx: JobContext = { db, pool, boss, redis };
    await notifyDispatchHandler(ctx, { selfRequeue: true });

    const jobs = await db.execute(sql`SELECT id FROM pgboss.job WHERE name = 'notify:dispatch'`);
    expect(jobs.rows).toHaveLength(0);
  });
});
