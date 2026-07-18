/**
 * WS6-T1 integration AC (§8.5): duo:matchmaker against a real Postgres.
 *   - band-widening-by-wait-time: entries with different waited-durations get different
 *     effective bands, so a distant-rated candidate is admitted only once the head has waited
 *     long enough (constructed via distinct `enqueued_at` values, per the AC's own wording).
 *   - eligibility gates re-checked at match time (claimed+active only).
 *   - excludes blocked pairs and not-yet-re-eligible prior partners (§8.5's disband rule).
 *   - creates the `duos` row (team rating = mean, RD 350), marks both queue entries `matched`,
 *     and queues the outbox notification for both.
 *   - drains multiple independent pairs in one tick.
 *   - the job handler self-requeues a follow-up tick (sub-minute cadence workaround, §8.5 vs.
 *     pg-boss's 1-minute cron floor).
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see .github/workflows/ci.yml
 * and every other integration test's fallback default) and Redis logical DB 6 via TEST_REDIS_URL
 * (any logical DB index is safe against CI's fresh redis7 container; no pre-creation needed,
 * unlike Postgres). When developing locally alongside other concurrent agents on the same
 * machine, export TEST_DATABASE_URL to point at a dedicated DB instead of changing this file's
 * fallback — turbo.json's globalPassThroughEnv doesn't include TEST_DATABASE_URL, so CI relies
 * on this literal default matching the shared convention.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import {
  blocks,
  connect,
  duoQueueEntries,
  duos,
  fingerprints,
  notifications,
  profiles,
  ratings,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { DUO_BAND_BASE, DUO_BAND_WIDEN } from '@receipts/core';
import { duoMatchmakerHandler, runDuoMatchmakerTick } from '../../src/jobs/duo-matchmaker.js';
import type { JobContext } from '../../src/context.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/6';

const AT = new Date('2026-07-20T12:00:00Z');

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.FLAG_DUO_QUEUE = 'true';
  process.env.REDIS_URL = redisUrl;
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

// Every test in this file drives `runDuoMatchmakerTick` over the WHOLE waiting pool (it isn't
// scoped to a caller-supplied profile set — matching the real job's behavior), so leftover rows
// from an earlier test would corrupt a later test's match counts. Full isolation between tests.
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE duo_queue_entries, duos, blocks, notifications, fingerprints, ratings, profiles CASCADE`,
  );
});

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const row = buildProfile({ kind: 'claimed', status: 'active', ...overrides });
  const [inserted] = await db.insert(profiles).values(row).returning();
  return inserted!;
}

async function enqueue(profileId: string, enqueuedAt: Date): Promise<string> {
  const id = uuidv7();
  await db.insert(duoQueueEntries).values({ id, profileId, status: 'waiting', enqueuedAt });
  return id;
}

async function setRating(profileId: string, glickoRating: number): Promise<void> {
  await db.insert(ratings).values({ profileId, glickoRating });
}

async function setFingerprint(
  profileId: string,
  chalk: number,
  categoryShares: Record<string, number>,
): Promise<void> {
  await db.insert(fingerprints).values({ profileId, chalk, categoryShares, computedAt: AT });
}

describe('runDuoMatchmakerTick — band widening by wait time (§8.5 AC)', () => {
  it('does NOT match a distant-rated candidate when the head has barely waited', async () => {
    const head = await makeClaimedProfile();
    const distant = await makeClaimedProfile();
    await setRating(head.id, 1500);
    await setRating(distant.id, 1500 + 299); // just outside DUO_BAND_BASE (150)

    await enqueue(head.id, AT); // wait_s = 0 → band = DUO_BAND_BASE (150)
    await enqueue(distant.id, AT);

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(0);

    const rows = await db
      .select({ status: duoQueueEntries.status })
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} IN (${head.id}, ${distant.id})`);
    expect(rows.every((r) => r.status === 'waiting')).toBe(true);
  });

  it('DOES match the same distant-rated candidate once the head has waited long enough', async () => {
    const head = await makeClaimedProfile();
    const distant = await makeClaimedProfile();
    await setRating(head.id, 1500);
    await setRating(distant.id, 1500 + 299); // needs band ≥ 299

    // band(wait_s) = DUO_BAND_BASE + DUO_BAND_WIDEN·floor(wait_s/30); 200s → 150 + 25·6 = 300 ≥ 299.
    const waitSeconds = 200;
    expect(DUO_BAND_BASE + DUO_BAND_WIDEN * Math.floor(waitSeconds / 30)).toBeGreaterThanOrEqual(299);
    const enqueuedAt = new Date(AT.getTime() - waitSeconds * 1000);

    await enqueue(head.id, enqueuedAt);
    await enqueue(distant.id, AT); // the candidate's own wait time doesn't matter — only the head's band applies

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(1);

    const [duo] = await db
      .select()
      .from(duos)
      .where(sql`${duos.profileAId} IN (${head.id}, ${distant.id}) OR ${duos.profileBId} IN (${head.id}, ${distant.id})`);
    expect(duo).toBeDefined();
    expect(duo!.glickoRating).toBeCloseTo((1500 + (1500 + 299)) / 2, 5);
    expect(duo!.glickoRd).toBe(350);
  });
});

describe('runDuoMatchmakerTick — match creation, eligibility, exclusions', () => {
  it('creates a duo, marks both entries matched, and queues an outbox notification for both', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const entryA = await enqueue(a.id, AT);
    const entryB = await enqueue(b.id, AT);

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(1);

    const [rowA] = await db.select().from(duoQueueEntries).where(sql`${duoQueueEntries.id} = ${entryA}`);
    const [rowB] = await db.select().from(duoQueueEntries).where(sql`${duoQueueEntries.id} = ${entryB}`);
    expect(rowA!.status).toBe('matched');
    expect(rowB!.status).toBe('matched');
    expect(rowA!.matchedDuoId).toBe(rowB!.matchedDuoId);

    const [duo] = await db.select().from(duos).where(sql`${duos.id} = ${rowA!.matchedDuoId}`);
    expect(duo!.status).toBe('active');
    expect(duo!.glickoRating).toBeCloseTo(1500, 5); // both default to 1500 (no ratings rows)
    expect([duo!.profileAId, duo!.profileBId].sort()).toEqual([a.id, b.id].sort());

    const notifRows = await db
      .select()
      .from(notifications)
      .where(sql`${notifications.kind} = 'duo_matched' AND ${notifications.profileId} IN (${a.id}, ${b.id})`);
    expect(notifRows).toHaveLength(2);
    for (const row of notifRows) {
      expect(row.status).toBe('queued');
      expect(row.channel).toBe('push');
      expect(row.payload).toMatchObject({ duo_id: duo!.id });
    }
  });

  it('ignores a waiting entry whose profile is no longer active (e.g. paused mid-wait)', async () => {
    const pausedProfile = await makeClaimedProfile({ status: 'paused_matchmaking' });
    const activeProfile = await makeClaimedProfile();
    const pausedEntry = await enqueue(pausedProfile.id, AT);
    await enqueue(activeProfile.id, AT);

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(0);

    const [row] = await db.select().from(duoQueueEntries).where(sql`${duoQueueEntries.id} = ${pausedEntry}`);
    expect(row!.status).toBe('waiting'); // untouched, not errored
  });

  it('does not match a blocked pair, even if otherwise in-band and eligible', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    await db.insert(blocks).values({ blockerProfileId: a.id, blockedProfileId: b.id });
    await enqueue(a.id, AT);
    await enqueue(b.id, AT);

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(0);
  });

  it('skips a blocked candidate but still matches the next-best one', async () => {
    const head = await makeClaimedProfile();
    const blocked = await makeClaimedProfile();
    const ok = await makeClaimedProfile();
    await db.insert(blocks).values({ blockerProfileId: head.id, blockedProfileId: blocked.id });

    await enqueue(head.id, AT);
    await enqueue(blocked.id, AT);
    await enqueue(ok.id, AT);

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(1);

    const [headEntry] = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${head.id}`);
    const [okEntry] = await db.select().from(duoQueueEntries).where(sql`${duoQueueEntries.profileId} = ${ok.id}`);
    const [blockedEntry] = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${blocked.id}`);
    expect(headEntry!.status).toBe('matched');
    expect(okEntry!.status).toBe('matched');
    expect(headEntry!.matchedDuoId).toBe(okEntry!.matchedDuoId);
    expect(blockedEntry!.status).toBe('waiting');
  });

  it('excludes a prior partner until BOTH have re-queued since the disband', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const [pa, pb] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const disbandedAt = new Date(AT.getTime() - 3600_000);
    await db.insert(duos).values({ id: uuidv7(), profileAId: pa, profileBId: pb, status: 'disbanded', updatedAt: disbandedAt });

    // Only `a` has re-queued since the disband — still excluded.
    await enqueue(a.id, AT);
    await enqueue(b.id, new Date(disbandedAt.getTime() - 1000)); // b's entry predates the disband

    let report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(0);

    // Now `b` re-queues too (after the disband) — eligible again.
    await db
      .update(duoQueueEntries)
      .set({ status: 'cancelled' })
      .where(sql`${duoQueueEntries.profileId} = ${b.id} AND ${duoQueueEntries.status} = 'waiting'`);
    await enqueue(b.id, AT);

    report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(1);
  });

  it('picks the better-complementarity in-band candidate over a same-style one', async () => {
    const head = await makeClaimedProfile();
    const sameStyle = await makeClaimedProfile();
    const opposite = await makeClaimedProfile();

    await setFingerprint(head.id, 0.8, { sports: 1 });
    await setFingerprint(sameStyle.id, 0.8, { sports: 1 }); // identical style → low complementarity
    await setFingerprint(opposite.id, -0.8, { politics: 1 }); // opposite style → high complementarity

    await enqueue(head.id, AT);
    await enqueue(sameStyle.id, AT);
    await enqueue(opposite.id, AT);

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(1);

    const [headEntry] = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${head.id}`);
    const [oppositeEntry] = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${opposite.id}`);
    const [sameStyleEntry] = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${sameStyle.id}`);
    expect(headEntry!.matchedDuoId).toBe(oppositeEntry!.matchedDuoId);
    expect(sameStyleEntry!.status).toBe('waiting');
  });

  it('drains multiple independent pairs in a single tick', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    await enqueue(a1.id, new Date(AT.getTime() - 4000));
    await enqueue(a2.id, new Date(AT.getTime() - 3000));
    await enqueue(b1.id, new Date(AT.getTime() - 2000));
    await enqueue(b2.id, new Date(AT.getTime() - 1000));

    const report = await runDuoMatchmakerTick(db, AT);
    expect(report.matched).toBe(2);

    const rows = await db
      .select({ status: duoQueueEntries.status })
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} IN (${a1.id}, ${a2.id}, ${b1.id}, ${b2.id})`);
    expect(rows.every((r) => r.status === 'matched')).toBe(true);
  });
});

describe('duoMatchmakerHandler — self-requeue (sub-minute cadence)', () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = new PgBoss({ connectionString: dbUrl, schema: 'pgboss' });
    await boss.start();
    await boss.createQueue('duo:matchmaker');
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM pgboss.job WHERE name = 'duo:matchmaker'`);
  });

  it('enqueues exactly one follow-up tick with a debouncing singleton key', async () => {
    const ctx: JobContext = { db, pool, boss, redis: undefined as unknown as JobContext['redis'] };
    await duoMatchmakerHandler(ctx, undefined);

    const jobs = await db.execute(sql`SELECT name, data, singleton_key FROM pgboss.job WHERE name = 'duo:matchmaker'`);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]!['singleton_key']).toBe('duo:matchmaker:self-requeue');
  });

  it('is a no-op (no self-requeue) when the duo_queue flag is disabled', async () => {
    process.env.FLAG_DUO_QUEUE = 'false';
    try {
      const ctx: JobContext = { db, pool, boss, redis: undefined as unknown as JobContext['redis'] };
      await duoMatchmakerHandler(ctx, undefined);
      const jobs = await db.execute(sql`SELECT id FROM pgboss.job WHERE name = 'duo:matchmaker'`);
      expect(jobs.rows).toHaveLength(0);
    } finally {
      process.env.FLAG_DUO_QUEUE = 'true';
    }
  });
});
