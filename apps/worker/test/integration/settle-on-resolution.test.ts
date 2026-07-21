/**
 * WS19-T1 (D-J3) integration AC: settlement follows the venue market's own resolution — any time
 * of day — with NO synchronized clock-scheduled reveal ceremony.
 *
 * Covers the task AC directly, against a real Postgres + Redis + pg-boss:
 *   1. Resolving a market grades picks AND stamps `revealed_at` within one tick (settlement:poll
 *      grades → grade:followup settles in the same enqueue chain), and the ISR revalidation
 *      (`/api/v1/internal/revalidate`) is hit.
 *   2. A voided market → voided question with streaks unaffected (existing §6.6 rule preserved).
 *   3. No job fires reveals by clock: `reveal:fire` is gone from the registry.
 *   4. The per-settle push fires only for a profile's FIRST settle of the day; a 2nd same-day
 *      settle is silent, and `settle:digest` (21:00 ET) covers the day with one summary push.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import { connect, markets, notifications, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { MockVenueAdapter } from '@receipts/venues/mock';
import { runSettlementPoll } from '../../src/jobs/settlement-poll.js';
import { runGradeFollowup } from '../../src/jobs/grade-followup.js';
import { runSettleDigest } from '../../src/jobs/settle-digest.js';
import { JOB_NAMES } from '../../src/registry.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;
let boss: PgBoss;

/** Captures every worker → web ISR revalidation POST so the AC can assert it fired. */
let revalidateServer: Server;
const revalidateCalls: Array<{ path: string; body: unknown }> = [];
const prevEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });

  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.flushdb();

  boss = new PgBoss({ connectionString: dbUrl, schema: 'pgboss' });
  await boss.start();
  await boss.createQueue('grade:followup');

  // Stub the web ISR revalidate endpoint (§9.2) and point the worker at it.
  revalidateServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      revalidateCalls.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { rejected: [] } }));
    });
  });
  await new Promise<void>((resolve) => revalidateServer.listen(0, '127.0.0.1', resolve));
  const addr = revalidateServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  prevEnv['NEXT_PUBLIC_APP_URL'] = process.env.NEXT_PUBLIC_APP_URL;
  prevEnv['INTERNAL_API_SECRET'] = process.env.INTERNAL_API_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${port}`;
  process.env.INTERNAL_API_SECRET = 'test-internal-secret';
});

afterAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = prevEnv['NEXT_PUBLIC_APP_URL'];
  process.env.INTERNAL_API_SECRET = prevEnv['INTERNAL_API_SECRET'];
  await new Promise<void>((resolve) => revalidateServer.close(() => resolve()));
  await boss.stop({ graceful: false });
  await pool.end();
  redis.disconnect();
});

/** A `locked` daily whose market a `MockVenueAdapter` can resolve, with pending picks. */
async function insertLockedDaily(opts: {
  venueMarketId: string;
  questionDate: string;
  pickProfiles: Array<{ profileId: string; side: 'yes' | 'no' }>;
}): Promise<{ questionId: string; slug: string }> {
  const market = buildMarket({ venue: 'kalshi', venueMarketId: opts.venueMarketId, status: 'closed' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    kind: 'daily',
    questionDate: opts.questionDate,
    status: 'locked',
  });
  await db.insert(questions).values(question);
  for (const p of opts.pickProfiles) {
    await db.insert(picks).values(
      buildPick(question.id as string, p.profileId, { side: p.side, yesPriceAtEntry: 0.5, result: 'pending' }),
    );
  }
  return { questionId: question.id as string, slug: question.slug as string };
}

describe('WS19-T1 — settle-on-resolution (D-J3)', () => {
  it('grades picks and stamps revealed_at within one tick, and hits ISR revalidation', async () => {
    const winner = buildProfile();
    const loser = buildProfile();
    await db.insert(profiles).values([winner, loser]);
    const { questionId, slug } = await insertLockedDaily({
      venueMarketId: 'SOR-RESOLVE-1',
      questionDate: '2026-07-21',
      pickProfiles: [
        { profileId: winner.id as string, side: 'yes' },
        { profileId: loser.id as string, side: 'no' },
      ],
    });

    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: 'SOR-RESOLVE-1' });
    adapter.resolve('SOR-RESOLVE-1', 'yes');

    const beforeCalls = revalidateCalls.length;
    // Tick: settlement:poll grades (question stays locked, settled_at set), then grade:followup
    // settles it in the same enqueue chain — no clock-scheduled reveal in between.
    const at = new Date('2026-07-21T13:45:00Z'); // mid-afternoon: settlement follows reality, any time
    const report = await runSettlementPoll(db, pool, boss, [adapter], new Date('2026-07-21T13:44:00Z'));
    expect(report.resolved).toBe(1);
    await runGradeFollowup(db, pool, redis, questionId, at);

    const [q] = await db.select().from(questions).where(eq(questions.id, questionId));
    expect(q!.status).toBe('revealed');
    expect(q!.revealedAt).toEqual(at); // stamped this tick — presentation reads it as "settled at"
    expect(q!.outcome).toBe('yes');

    const gradedPicks = await db.select().from(picks).where(eq(picks.questionId, questionId));
    const byProfile = new Map(gradedPicks.map((p) => [p.profileId, p]));
    expect(byProfile.get(winner.id as string)!.result).toBe('win');
    expect(byProfile.get(loser.id as string)!.result).toBe('loss');

    // Streak applied in-tick for the graded participants.
    const [winnerAfter] = await db.select().from(profiles).where(eq(profiles.id, winner.id as string));
    expect(winnerAfter!.currentStreak).toBe(1);

    // ISR revalidation hit `/api/v1/internal/revalidate` with the question + home paths (§9.2).
    const newCalls = revalidateCalls.slice(beforeCalls);
    expect(newCalls.length).toBeGreaterThanOrEqual(1);
    const call = newCalls.at(-1)!;
    expect(call.path).toBe('/api/v1/internal/revalidate');
    expect((call.body as { paths: string[] }).paths).toEqual([`/q/${slug}`, '/']);
  });

  it('a voided market → voided question, streaks unaffected (existing §6.6 rule)', async () => {
    const holder = buildProfile({ currentStreak: 3, bestStreak: 3, lastCountedDate: '2026-07-20' });
    await db.insert(profiles).values(holder);
    const { questionId } = await insertLockedDaily({
      venueMarketId: 'SOR-VOID-1',
      questionDate: '2026-07-23',
      pickProfiles: [{ profileId: holder.id as string, side: 'yes' }],
    });

    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: 'SOR-VOID-1' });
    adapter.void('SOR-VOID-1');

    const report = await runSettlementPoll(db, pool, boss, [adapter], new Date('2026-07-21T14:00:00Z'));
    expect(report.voided).toBe(1);

    const [q] = await db.select().from(questions).where(eq(questions.id, questionId));
    expect(q!.status).toBe('voided');
    const [pick] = await db.select().from(picks).where(eq(picks.questionId, questionId));
    expect(pick!.result).toBe('void');

    // The void path never enqueues grade:followup and never touches streaks (§6.6: a void day
    // neither counts nor breaks). The holder's streak is exactly as seeded.
    const [after] = await db.select().from(profiles).where(eq(profiles.id, holder.id as string));
    expect(after!.currentStreak).toBe(3);
    expect(after!.bestStreak).toBe(3);
    expect(after!.lastCountedDate).toBe('2026-07-20');
  });

  it('no job fires reveals by clock — reveal:fire is gone from the registry', () => {
    expect(JOB_NAMES).not.toContain('reveal:fire');
    expect(JOB_NAMES).toContain('settle:digest');
  });

  it('per-settle push fires only for the first settle of a profile day; settle:digest covers the rest', async () => {
    const player = buildProfile();
    await db.insert(profiles).values(player);

    // Two DIFFERENT question_dates whose markets both resolve on the SAME calendar day — exactly
    // the D-J3 shape: settlement follows the market's clock, not the question's date, so a profile
    // can have several positions settle in one day (the daily-per-date unique index still holds).
    const q1 = await insertLockedDaily({
      venueMarketId: 'SOR-DIGEST-A',
      questionDate: '2026-07-24',
      pickProfiles: [{ profileId: player.id as string, side: 'yes' }],
    });
    const q2 = await insertLockedDaily({
      venueMarketId: 'SOR-DIGEST-B',
      questionDate: '2026-07-25',
      pickProfiles: [{ profileId: player.id as string, side: 'yes' }],
    });

    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: 'SOR-DIGEST-A' });
    adapter.addMarket({ venueMarketId: 'SOR-DIGEST-B' });
    adapter.resolve('SOR-DIGEST-A', 'yes');
    adapter.resolve('SOR-DIGEST-B', 'yes');

    await runSettlementPoll(db, pool, boss, [adapter], new Date('2026-07-26T09:00:00Z'));
    // Both settle on the same ET day (2026-07-26), four hours apart.
    await runGradeFollowup(db, pool, redis, q1.questionId, new Date('2026-07-26T11:00:00Z'));
    await runGradeFollowup(db, pool, redis, q2.questionId, new Date('2026-07-26T15:00:00Z'));

    // Exactly ONE per-settle push for the player on 2026-07-26 — the first settle only. The 2nd
    // deduped on `reveal_settle:2026-07-26:{profile}`.
    const settlePushes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, player.id as string), eq(notifications.kind, 'reveal_settle')));
    expect(settlePushes).toHaveLength(1);
    expect(settlePushes[0]!.dedupeKey).toBe(`reveal_settle:2026-07-26:${player.id}`);

    // The 21:00 ET digest sweeps the day: the player had 2 settles → one summary push.
    const digestReport = await runSettleDigest(db, new Date('2026-07-27T01:00:00Z')); // 21:00 ET on 07-26
    expect(digestReport.etDate).toBe('2026-07-26');
    expect(digestReport.eligible).toBe(1);
    expect(digestReport.pushed).toBe(1);

    const digestPushes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, player.id as string), eq(notifications.kind, 'reveal_digest')));
    expect(digestPushes).toHaveLength(1);
    expect(digestPushes[0]!.dedupeKey).toBe(`reveal_settle_digest:2026-07-26:${player.id}`);

    // Idempotent: a redelivered digest never double-pushes.
    const second = await runSettleDigest(db, new Date('2026-07-27T01:00:00Z'));
    expect(second.pushed).toBe(0);
  });
});
