/**
 * SW9-T1 (obituary-handoff §3.1–§3.2): `viewer.streak.broken_run` emission — the REAL
 * `buildRevealPayload` against really-seeded Postgres history, per the doc's §1 binding rule
 * (PR #75's post-mortem): NO hand-built payload shapes, no mocks of the reveal contract —
 * every case seeds actual `questions`/`picks`/`streak_freeze_uses` rows and asserts on what
 * the server genuinely emits. AC letters (a)–(g) from the doc's §4 SW9-T1 entry are marked on
 * each test; (h) — the sweep-ordering beat case — lives in
 * `apps/worker/test/integration/streak-busted-wake.test.ts` (it needs the real jobs).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import {
  connect,
  getMarketById,
  getPicksForProfile,
  getQuestionById,
  listRevealedOrVoidedDailyThrough,
  markets,
  picks,
  profiles,
  questions,
  replayStreak,
  streakFreezeUses,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { buildRevealPayload } from '@/lib/reveal-payload';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

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
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
});

afterAll(async () => {
  await pool.end();
  redis.disconnect();
});

interface SeededDay {
  question: ReturnType<typeof buildQuestion>;
  pick: ReturnType<typeof buildPick> | null;
}

/**
 * Seeds one settled daily for `date`: a resolved market + a revealed (or voided) question, and —
 * when `side` is given — the viewer's graded pick on it. Outcome is always YES, so `side: 'yes'`
 * wins and `side: 'no'` loses; `entry` is the stamped yes-price.
 */
async function seedDay(
  viewerId: string,
  date: string,
  opts: { side?: 'yes' | 'no'; entry?: number; voided?: boolean; yesLabel?: string; noLabel?: string } = {},
): Promise<SeededDay> {
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const settledAt = new Date(`${date}T17:00:00Z`);
  const question = buildQuestion(market.id as string, {
    questionDate: date,
    slug: `${date}-broken-run-day`,
    status: opts.voided ? 'voided' : 'revealed',
    outcome: opts.voided ? null : 'yes',
    settledAt: opts.voided ? null : settledAt,
    revealedAt: opts.voided ? null : new Date(`${date}T20:00:00Z`),
    voidReason: opts.voided ? 'test void' : null,
    crowdYesAtLock: 1,
    crowdNoAtLock: 1,
    yesLabel: opts.yesLabel ?? 'Yes',
    noLabel: opts.noLabel ?? 'No',
  });
  await db.insert(questions).values(question);

  let pick: ReturnType<typeof buildPick> | null = null;
  if (opts.side) {
    const entry = opts.entry ?? 0.5;
    const won = opts.side === 'yes';
    pick = buildPick(question.id as string, viewerId, {
      side: opts.side,
      yesPriceAtEntry: entry,
      result: opts.voided ? 'void' : won ? 'win' : 'loss',
      edge: opts.voided ? null : computeEdge(opts.side, entry, won),
      gradedAt: opts.voided ? null : settledAt,
    });
    await db.insert(picks).values(pick);
  }
  return { question, pick };
}

/** Builds the REAL reveal payload for the seeded daily `day` as `viewerId`. */
async function payloadFor(viewerId: string, day: SeededDay, at: Date) {
  const question = await getQuestionById(db, day.question.id as string);
  const market = await getMarketById(db, day.question.marketId as string);
  return buildRevealPayload({
    db,
    redis,
    question: question!,
    market: market!,
    viewerProfileId: viewerId,
    appUrl: 'https://receipts.example',
    at,
  });
}

describe('viewer.streak.broken_run (SW9-T1, obituary-handoff §3.2)', () => {
  it('(a) a >=3-day run + uncovered miss + first-day-back reveal emits broken_run with exact length/dates/last_pick', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-03-01', { side: 'yes', entry: 0.6 });
    await seedDay(id, '2026-03-02', { side: 'no', entry: 0.75 }); // implied NO entry: 25¢ — run's cheapest
    const death = await seedDay(id, '2026-03-03', {
      side: 'yes',
      entry: 0.4,
      yesLabel: 'HOLDS',
      noLabel: 'BREAKS',
    });
    await seedDay(id, '2026-03-04'); // revealed daily, viewer missed, no freeze -> the run dies
    const wake = await seedDay(id, '2026-03-05', { side: 'yes', entry: 0.5 });

    const payload = await payloadFor(id, wake, new Date('2026-03-05T20:05:00Z'));
    const streak = payload.viewer!.streak;
    expect(streak.current).toBe(1);
    expect(streak.delta).toBe(1);
    expect(streak.broken_run).toEqual({
      length: 3,
      started_on: '2026-03-01',
      ended_on: '2026-03-03', // the last COUNTED date — never the missed 03-04
      last_pick: {
        pick_id: death.pick!.id,
        side_label: 'HOLDS', // the death question's OWN label for the held side
        entry_cents: 40,
        question_slug: '2026-03-03-broken-run-day',
      },
      freezes_survived: 0,
      longest_odds_cents: 25, // cheapest implied entry among the run's picks (the NO @ 25¢)
    });
  });

  it('(b) no gap -> broken_run is null', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-03-10', { side: 'yes' });
    await seedDay(id, '2026-03-11', { side: 'yes' });
    const day3 = await seedDay(id, '2026-03-12', { side: 'yes' });

    const payload = await payloadFor(id, day3, new Date('2026-03-12T20:05:00Z'));
    expect(payload.viewer!.streak.broken_run).toBeNull();
    expect(payload.viewer!.streak.current).toBe(3);
  });

  it('(c) freeze-covered gap -> null (no death happened)', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-03-20', { side: 'yes' });
    await seedDay(id, '2026-03-21'); // missed but covered below
    await db.insert(streakFreezeUses).values({
      profileId: id,
      coveredDate: '2026-03-21',
      usedAt: new Date('2026-03-22T03:30:00Z'),
    });
    const day3 = await seedDay(id, '2026-03-22', { side: 'yes' });

    const payload = await payloadFor(id, day3, new Date('2026-03-22T20:05:00Z'));
    expect(payload.viewer!.streak.broken_run).toBeNull();
    expect(payload.viewer!.streak.freeze_used).toBe(true);
    expect(payload.viewer!.streak.current).toBe(2);
  });

  it('(d) voided-tail run: last_pick resolves to the latest ANSWERED date, not ended_on', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-04-01', { side: 'yes', entry: 0.6 });
    const lastAnswered = await seedDay(id, '2026-04-02', { side: 'yes', entry: 0.55 });
    await seedDay(id, '2026-04-03', { voided: true }); // contiguous void extends the run
    await seedDay(id, '2026-04-04'); // uncovered miss -> fatal
    const wake = await seedDay(id, '2026-04-05', { side: 'yes' });

    const payload = await payloadFor(id, wake, new Date('2026-04-05T20:05:00Z'));
    const broken = payload.viewer!.streak.broken_run!;
    expect(broken.length).toBe(2);
    expect(broken.started_on).toBe('2026-04-01');
    expect(broken.ended_on).toBe('2026-04-03'); // the void the viewer never picked
    expect(broken.last_pick!.pick_id).toBe(lastAnswered.pick!.id); // latest ANSWERED <= ended_on
    expect(broken.last_pick!.question_slug).toBe('2026-04-02-broken-run-day');
    expect(broken.freezes_survived).toBe(0);
  });

  it('(d) freeze-covered-tail run: last_pick is the latest answered date and the tail freeze counts in freezes_survived', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-04-10', { side: 'yes', entry: 0.6 });
    const lastAnswered = await seedDay(id, '2026-04-11', { side: 'no', entry: 0.7 }); // implied NO: 30¢
    await seedDay(id, '2026-04-12'); // missed, freeze-covered -> the covered date JOINS the run
    await db.insert(streakFreezeUses).values({
      profileId: id,
      coveredDate: '2026-04-12',
      usedAt: new Date('2026-04-13T03:30:00Z'),
    });
    await seedDay(id, '2026-04-13'); // uncovered miss the day after the bridge -> fatal
    const wake = await seedDay(id, '2026-04-14', { side: 'yes' });

    const payload = await payloadFor(id, wake, new Date('2026-04-14T20:05:00Z'));
    const broken = payload.viewer!.streak.broken_run!;
    expect(broken.length).toBe(2);
    expect(broken.started_on).toBe('2026-04-10');
    expect(broken.ended_on).toBe('2026-04-12'); // freeze-covered tail belongs to the run (§3.1)
    expect(broken.last_pick!.pick_id).toBe(lastAnswered.pick!.id);
    expect(broken.last_pick!.entry_cents).toBe(30);
    // Half-open (started_on, ended_on]: the boundary (tail) freeze on 04-12 is counted.
    expect(broken.freezes_survived).toBe(1);
    expect(broken.longest_odds_cents).toBe(30); // min(60¢ yes, 30¢ no)
  });

  it('(e) second-day-back reveal -> null (the funeral fires once); the wake reveal itself stays replayable', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-04-20', { side: 'yes' });
    await seedDay(id, '2026-04-21', { side: 'yes' });
    await seedDay(id, '2026-04-22', { side: 'yes' });
    await seedDay(id, '2026-04-23'); // uncovered miss
    const wakeDay = await seedDay(id, '2026-04-24', { side: 'yes' });
    const dayAfter = await seedDay(id, '2026-04-25', { side: 'yes' });

    const wakePayload = await payloadFor(id, wakeDay, new Date('2026-04-26T09:00:00Z'));
    expect(wakePayload.viewer!.streak.broken_run?.length).toBe(3);

    const dayAfterPayload = await payloadFor(id, dayAfter, new Date('2026-04-26T09:00:00Z'));
    expect(dayAfterPayload.viewer!.streak.broken_run).toBeNull();
    expect(dayAfterPayload.viewer!.streak.current).toBe(2);

    // Reveal pages are replayable (§2 accepted edge): revisiting the wake reveal later — even
    // after the day-after reveal has fired — still shows the same funeral.
    const wakeAgain = await payloadFor(id, wakeDay, new Date('2026-04-27T09:00:00Z'));
    expect(wakeAgain.viewer!.streak.broken_run?.length).toBe(3);
  });

  it('(f) falsification: a LOSS with an intact streak emits null — current >= 1, delta +1 (the PR #75 shape stays impossible)', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-05-01', { side: 'yes' });
    await seedDay(id, '2026-05-02', { side: 'yes' });
    const lossDay = await seedDay(id, '2026-05-03', { side: 'no', entry: 0.3 }); // outcome YES -> loss

    const payload = await payloadFor(id, lossDay, new Date('2026-05-03T20:05:00Z'));
    expect(payload.viewer!.result).toBe('loss');
    // The participation streak INCREMENTS on a loss — `loss && current === 0` can never fire.
    expect(payload.viewer!.streak.current).toBe(3);
    expect(payload.viewer!.streak.delta).toBe(1);
    expect(payload.viewer!.streak.broken_run).toBeNull();
  });

  it('(g) zero-guard falsification: N consecutive missed days record exactly ONE run — and the wake still fires off it', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    await seedDay(id, '2026-05-10', { side: 'yes' });
    await seedDay(id, '2026-05-11', { side: 'yes' });
    await seedDay(id, '2026-05-12'); // miss 1
    await seedDay(id, '2026-05-13'); // miss 2
    await seedDay(id, '2026-05-14'); // miss 3
    const wake = await seedDay(id, '2026-05-15', { side: 'yes' });

    // The replay over the REAL fetched history (same repositories the payload builder uses):
    // exactly ONE completed run, no zero-length garbage entries from misses 2 and 3.
    const history = await listRevealedOrVoidedDailyThrough(db, '2026-05-15');
    const viewerPicks = await getPicksForProfile(db, id);
    const replay = replayStreak(
      history.filter((q) => q.questionDate >= '2026-05-10' && q.questionDate <= '2026-05-15'),
      viewerPicks,
      [],
    );
    expect(replay.runs).toEqual([{ length: 2, startedOn: '2026-05-10', endedOn: '2026-05-11' }]);
    expect(replay.runs.every((r) => r.length >= 1)).toBe(true);

    // And the payload's wake condition (`runs.length > 0 && currentRunStartedOn === today`)
    // still holds — a garbage-free `runs` is exactly what keeps the trigger alive.
    const payload = await payloadFor(id, wake, new Date('2026-05-15T20:05:00Z'));
    expect(payload.viewer!.streak.broken_run).toEqual({
      length: 2,
      started_on: '2026-05-10',
      ended_on: '2026-05-11',
      last_pick: expect.objectContaining({ question_slug: '2026-05-11-broken-run-day' }),
      freezes_survived: 0,
      longest_odds_cents: 50,
    });
  });

  it('first-ever pick emits null (runs.length > 0 excludes it — sound because of the zero-guard)', async () => {
    const viewer = buildProfile();
    await db.insert(profiles).values(viewer);
    const id = viewer.id as string;

    // Dailies existed (and were missed) before the viewer's first-ever pick.
    await seedDay(id, '2026-05-20');
    await seedDay(id, '2026-05-21');
    const firstEver = await seedDay(id, '2026-05-22', { side: 'yes' });

    const payload = await payloadFor(id, firstEver, new Date('2026-05-22T20:05:00Z'));
    expect(payload.viewer!.streak.broken_run).toBeNull();
    expect(payload.viewer!.streak.current).toBe(1);
  });
});
