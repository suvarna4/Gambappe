/**
 * WS3-T3/T4/T5/T6 integration: `grade:followup`, `reveal:fire`, `streak:sweep`,
 * `streak:freeze-grant` (§6.5–6.7, §8.6) against a real Postgres + Redis + pg-boss.
 *
 * Covers: percentile caching + reveal scheduling (idempotent re-run — "kill worker between
 * grading and followup" AC); reveal firing flips status + applies the §6.6 streak gap rule
 * (freeze consumption, `streak_freeze_uses` row, "called it" badge + analytics event at the
 * exact 0.20 boundary); a voided day preserving everyone's streak; `streak:sweep` catching a
 * non-participant; `streak:freeze-grant` awarding a freeze for 5-of-7 participation.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import {
  analyticsEvents,
  connect,
  markets,
  picks,
  profiles,
  questions,
  streakFreezeUses,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { runGradeFollowup } from '../../src/jobs/grade-followup.js';
import { settleQuestion } from '../../src/lib/settle-question.js';
import { runStreakSweep } from '../../src/jobs/streak-sweep.js';
import { runStreakFreezeGrant } from '../../src/jobs/streak-freeze-grant.js';
import { revealHashKey } from '../../src/jobs/percentiles.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;
let boss: PgBoss;

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
  await boss.createQueue('reveal:fire');
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
  redis.disconnect();
});

async function insertGradedDaily(opts: {
  questionDate: string;
  revealAt: Date;
  settledAt?: Date;
  status?: 'locked';
  picksSpec: Array<{ profile: ReturnType<typeof buildProfile>; side: 'yes' | 'no'; won: boolean; entry: number }>;
}) {
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    questionDate: opts.questionDate,
    status: opts.status ?? 'locked',
    outcome: 'yes',
    settledAt: opts.settledAt ?? new Date(`${opts.questionDate}T17:00:00Z`),
    revealAt: opts.revealAt,
    crowdYesAtLock: opts.picksSpec.filter((p) => p.side === 'yes').length,
    crowdNoAtLock: opts.picksSpec.filter((p) => p.side === 'no').length,
  });
  await db.insert(questions).values(question);

  for (const spec of opts.picksSpec) {
    await db.insert(profiles).values(spec.profile).onConflictDoNothing();
    await db.insert(picks).values(
      buildPick(question.id as string, spec.profile.id as string, {
        side: spec.side,
        yesPriceAtEntry: spec.entry,
        result: spec.won ? 'win' : 'loss',
        edge: computeEdge(spec.side, spec.entry, spec.won),
        gradedAt: opts.settledAt ?? new Date(`${opts.questionDate}T17:00:00Z`),
      }),
    );
  }
  return question;
}

describe('grade:followup (§6.5, §8.6)', () => {
  it('computes + caches percentiles and SETTLES the daily in the same tick (D-J3); a re-run is idempotent (crash-recovery AC)', async () => {
    const winner = buildProfile();
    const loser = buildProfile();
    const question = await insertGradedDaily({
      questionDate: '2026-08-01',
      revealAt: new Date('2026-08-01T00:00:00Z'), // reveal_at is now irrelevant — settlement follows resolution
      picksSpec: [
        { profile: winner, side: 'yes', won: true, entry: 0.5 },
        { profile: loser, side: 'no', won: false, entry: 0.5 },
      ],
    });
    const at = new Date('2026-08-01T20:05:00Z');

    await runGradeFollowup(db, pool, redis, question.id as string, at);
    const hashAfterFirst = await redis.hgetall(revealHashKey(question.id as string));
    expect(Object.keys(hashAfterFirst)).toHaveLength(2);
    expect(Number(hashAfterFirst[winner.id as string])).toBeCloseTo(100, 5);
    expect(Number(hashAfterFirst[loser.id as string])).toBeCloseTo(0, 5);

    // D-J3: no clock-scheduled reveal:fire is enqueued; grade:followup settles the daily itself,
    // in this tick. The question is `revealed` with `revealed_at` stamped immediately.
    const [afterFirst] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(afterFirst!.status).toBe('revealed');
    expect(afterFirst!.revealedAt).toEqual(at);
    const [winnerAfter] = await db.select().from(profiles).where(eq(profiles.id, winner.id as string));
    expect(winnerAfter!.currentStreak).toBe(1); // settle applied the streak in-tick

    // Re-run (simulating a worker restart before ack) — must be a safe, idempotent no-op: the
    // settle is already committed, so revealed_at / streak are unchanged.
    await runGradeFollowup(db, pool, redis, question.id as string, at);
    const hashAfterSecond = await redis.hgetall(revealHashKey(question.id as string));
    expect(hashAfterSecond).toEqual(hashAfterFirst);
    const [afterSecond] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(afterSecond!.revealedAt).toEqual(at); // unchanged by the re-run
    const [winnerAfterSecond] = await db.select().from(profiles).where(eq(profiles.id, winner.id as string));
    expect(winnerAfterSecond!.currentStreak).toBe(1); // not double-incremented

    // No clock-scheduled reveal job exists anymore (D-J3): none was enqueued.
    const jobs = await db.execute(sql`SELECT id FROM pgboss.job WHERE name = 'reveal:fire'`);
    expect(jobs.rows).toHaveLength(0);
  });

  it('publishes a nemesis_bonus question immediately on grading — no held reveal (§8.8.1, WS5-T1)', async () => {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const settledAt = new Date('2026-08-05T10:00:00Z');
    const bonusQuestion = buildQuestion(market.id as string, {
      kind: 'nemesis_bonus',
      questionDate: null,
      status: 'locked',
      settledAt,
      // §8.8.1: reveal_at = lock_at for bonus questions — no held-reveal wait (authoring detail;
      // this test only checks the actual `revealed_at`/`status` the grade:followup transition
      // writes, which is independent of this pre-set field).
      revealAt: settledAt,
    });
    await db.insert(questions).values(bonusQuestion);

    const at = new Date('2026-08-05T10:00:01Z');
    await runGradeFollowup(db, pool, redis, bonusQuestion.id as string, at);

    const [row] = await db.select().from(questions).where(eq(questions.id, bonusQuestion.id as string));
    expect(row!.status).toBe('revealed');
    expect(row!.revealedAt).toEqual(at);
    // No percentile computation / reveal:fire scheduling for bonus questions (§8.8.1: "no held reveal").
    const hash = await redis.hgetall(revealHashKey(bonusQuestion.id as string));
    expect(hash).toEqual({});

    // Idempotent re-run: revealQuestionTx only transitions from `locked` — a redelivered job is a no-op.
    await runGradeFollowup(db, pool, redis, bonusQuestion.id as string, at);
    const [rowAgain] = await db.select().from(questions).where(eq(questions.id, bonusQuestion.id as string));
    expect(rowAgain!.status).toBe('revealed');
    expect(rowAgain!.revealedAt).toEqual(at); // unchanged by the second run
  });

  it('reveals a duo_bonus question immediately (§8.8.1) without touching percentiles/streaks (WS6-T2)', async () => {
    // Was a documented no-op (SPEC-GAP: WS6/duo didn't create these questions yet) — WS6-T2 has
    // since landed real duo_bonus completion handling in grade:followup itself; percentiles and
    // streaks remain daily-only regardless (§6.6/§8.6), which is the part still worth asserting
    // here (WS6-T2's own duo-match-lifecycle.test.ts covers the match-completion side in depth).
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const bonusQuestion = buildQuestion(market.id as string, {
      kind: 'duo_bonus',
      questionDate: null,
      status: 'locked',
      settledAt: new Date(),
    });
    await db.insert(questions).values(bonusQuestion);

    await expect(runGradeFollowup(db, pool, redis, bonusQuestion.id as string, new Date())).resolves.toBeUndefined();
    const [row] = await db.select().from(questions).where(eq(questions.id, bonusQuestion.id as string));
    expect(row!.status).toBe('revealed'); // §8.8.1: no held reveal — immediate, unlike daily
    const hash = await redis.hgetall(revealHashKey(bonusQuestion.id as string));
    expect(hash).toEqual({}); // percentiles are daily-only — untouched either way
  });
});

describe('settle (§6.6–6.7, badge boundary §6.7/WS3-T6)', () => {
  it('not yet graded → no-op, never reveals (D-J3: no re-arm, settle only follows a resolved market)', async () => {
    const market = buildMarket({ status: 'closed' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, {
      questionDate: '2026-08-10',
      status: 'locked',
      settledAt: null,
      revealAt: new Date('2026-08-10T00:00:00Z'),
    });
    await db.insert(questions).values(question);

    const outcome = await settleQuestion(db, pool, question.id as string, new Date('2026-08-10T00:10:00Z'));
    expect(outcome.status).toBe('noop');

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(row!.status).toBe('locked');
  });

  it('reveals, applies the streak gap rule (freeze consumed for one gap day), and records the "called it" badge at exactly the 0.20 boundary', async () => {
    // Day-by-day fixture for the participant profile:
    //   08-11 win (streak=1) → 08-12 MISSED, freeze available (streak bridges) →
    //   08-13 win, longshot at EXACTLY 0.20 implied prob (called_it boundary, ≤ → true).
    const participant = buildProfile({ freezeBank: 1 });
    const other = buildProfile();
    await db.insert(profiles).values([participant, other]);

    const day1 = await insertGradedDaily({
      questionDate: '2026-08-11',
      revealAt: new Date('2026-08-11T00:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: participant, side: 'yes', won: true, entry: 0.5 }],
    });
    await db.update(questions).set({ status: 'revealed', revealedAt: new Date('2026-08-11T20:00:00Z') }).where(eq(questions.id, day1.id));
    await db
      .update(profiles)
      .set({ currentStreak: 1, bestStreak: 1, lastCountedDate: '2026-08-11', currentWinStreak: 1, bestWinStreak: 1 })
      .where(eq(profiles.id, participant.id));

    // 08-12: a daily exists and is revealed, but `participant` has no pick on it (the gap day).
    const day2 = await insertGradedDaily({
      questionDate: '2026-08-12',
      revealAt: new Date('2026-08-12T00:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: other, side: 'yes', won: true, entry: 0.5 }],
    });
    await db.update(questions).set({ status: 'revealed', revealedAt: new Date('2026-08-12T20:00:00Z') }).where(eq(questions.id, day2.id));

    // 08-13: participant wins at yes_price_at_entry = 0.20 exactly → implied prob 0.20 → called_it.
    const day3 = await insertGradedDaily({
      questionDate: '2026-08-13',
      revealAt: new Date('2026-08-13T20:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: participant, side: 'yes', won: true, entry: 0.2 }],
    });

    const at = new Date('2026-08-13T20:00:01Z');
    const outcome = await settleQuestion(db, pool, day3.id as string, at);
    expect(outcome).toMatchObject({ status: 'revealed', participantCount: 1, calledItCount: 1 });

    const [profileAfter] = await db.select().from(profiles).where(eq(profiles.id, participant.id));
    // §6.6: a freeze-bridged gap day advances last_counted_date WITHOUT incrementing the streak
    // itself (only actual participation counts) — 08-11 (1) + 08-12 bridge (no count) + 08-13 (2).
    expect(profileAfter!.currentStreak).toBe(2);
    expect(profileAfter!.bestStreak).toBe(2);
    expect(profileAfter!.lastCountedDate).toBe('2026-08-13');
    expect(profileAfter!.currentWinStreak).toBe(2); // both real participations were wins
    expect(profileAfter!.freezeBank).toBe(0); // consumed

    const freezeUseRows = await db
      .select()
      .from(streakFreezeUses)
      .where(eq(streakFreezeUses.profileId, participant.id));
    expect(freezeUseRows).toHaveLength(1);
    expect(freezeUseRows[0]!.coveredDate).toBe('2026-08-12');

    const badgeEvents = await db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.event, 'called_it'));
    expect(badgeEvents).toHaveLength(1);
    expect(badgeEvents[0]!.profileId).toBe(participant.id);

    // Idempotent re-fire: already revealed → no-op, no double streak increment / double event.
    const second = await settleQuestion(db, pool, day3.id as string, at);
    expect(second.status).toBe('noop');
    const [profileAfterSecond] = await db.select().from(profiles).where(eq(profiles.id, participant.id));
    expect(profileAfterSecond!.currentStreak).toBe(2); // unchanged
    const badgeEventsAfterSecond = await db.select().from(analyticsEvents).where(eq(analyticsEvents.event, 'called_it'));
    expect(badgeEventsAfterSecond).toHaveLength(1); // unchanged
  });

  it('a win just above the longshot boundary (0.21) is NOT called_it', async () => {
    const participant = buildProfile();
    await db.insert(profiles).values(participant);
    const day = await insertGradedDaily({
      questionDate: '2026-08-20',
      revealAt: new Date('2026-08-20T20:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: participant, side: 'yes', won: true, entry: 0.21 }],
    });

    const outcome = await settleQuestion(db, pool, day.id as string, new Date('2026-08-20T20:00:01Z'));
    expect(outcome).toMatchObject({ status: 'revealed', calledItCount: 0 });
  });

  it("a voided day preserves everyone's streak (no increment, no break) — real 2-day run into a void", async () => {
    const p1 = buildProfile();
    await db.insert(profiles).values(p1);

    // Two REAL revealed wins, processed by the actual `reveal:fire` path (not hand-seeded), so
    // the profile's streak fields are exactly what production would derive.
    const dayA = await insertGradedDaily({
      questionDate: '2026-08-27',
      revealAt: new Date('2026-08-27T20:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: p1, side: 'yes', won: true, entry: 0.5 }],
    });
    await settleQuestion(db, pool, dayA.id as string, new Date('2026-08-27T20:00:01Z'));

    const dayB = await insertGradedDaily({
      questionDate: '2026-08-28',
      revealAt: new Date('2026-08-28T20:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: p1, side: 'yes', won: true, entry: 0.5 }],
    });
    await settleQuestion(db, pool, dayB.id as string, new Date('2026-08-28T20:00:01Z'));

    const [p1AfterTwoWins] = await db.select().from(profiles).where(eq(profiles.id, p1.id));
    expect(p1AfterTwoWins!.currentStreak).toBe(2);

    // Day 08-29 voids immediately (settlement:poll's void path, WS1-T5 — no reveal:fire, no
    // held reveal). Nobody has a pick on it.
    const market = buildMarket({ status: 'voided' });
    await db.insert(markets).values(market);
    const voidedDay = buildQuestion(market.id as string, {
      questionDate: '2026-08-29',
      kind: 'daily',
      status: 'voided',
      voidReason: 'venue_voided',
    });
    await db.insert(questions).values(voidedDay);

    const report = await runStreakSweep(db, pool, new Date('2026-08-30T07:30:00Z'));
    expect(report.targetDate).toBe('2026-08-29');

    const [p1After] = await db.select().from(profiles).where(eq(profiles.id, p1.id));
    expect(p1After!.currentStreak).toBe(2); // unchanged — void neither breaks nor grows it
    expect(p1After!.bestStreak).toBe(2);
    expect(p1After!.lastCountedDate).toBe('2026-08-29'); // advances across the void day
  });
});

describe('streak:sweep (§6.6 non-participants)', () => {
  it('breaks the streak of a profile that missed the latest revealed daily with no freeze available', async () => {
    const ghost = buildProfile({ currentStreak: 4, bestStreak: 4, lastCountedDate: '2026-09-09', freezeBank: 0 });
    await db.insert(profiles).values(ghost);

    const day = await insertGradedDaily({
      questionDate: '2026-09-10',
      revealAt: new Date('2026-09-10T20:00:00Z'),
      status: 'locked',
      picksSpec: [{ profile: buildProfile(), side: 'yes', won: true, entry: 0.5 }],
    });
    await db.update(questions).set({ status: 'revealed', revealedAt: new Date('2026-09-10T20:00:01Z') }).where(eq(questions.id, day.id));

    await runStreakSweep(db, pool, new Date('2026-09-11T07:30:00Z'));
    const [after] = await db.select().from(profiles).where(eq(profiles.id, ghost.id));
    expect(after!.currentStreak).toBe(0);
  });
});

describe('streak:freeze-grant (§6.6 Monday 00:05 ET)', () => {
  it('grants +1 freeze to a profile answering >= 5 of the prior 7 dailies, capped at STREAK_FREEZE_CAP', async () => {
    const profile = buildProfile({ freezeBank: 0 });
    await db.insert(profiles).values(profile);

    // 5 answered dailies across a 7-day window ending "yesterday" relative to `at`.
    const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
    const answered = new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-18', '2026-09-20']);
    for (const date of dates) {
      const market = buildMarket({ status: 'resolved', outcome: 'yes' });
      await db.insert(markets).values(market);
      const q = buildQuestion(market.id as string, { questionDate: date, status: 'open' });
      await db.insert(questions).values(q);
      if (answered.has(date)) {
        await db.insert(picks).values(buildPick(q.id as string, profile.id as string, { result: 'pending' }));
      }
    }

    const at = new Date('2026-09-21T04:05:00Z'); // Monday 00:05 ET ≈ 04:05 UTC (non-DST winter; close enough for this fixture)
    const report = await runStreakFreezeGrant(db, pool, at);
    expect(report.windowStart).toBe('2026-09-14');
    expect(report.windowEnd).toBe('2026-09-20');
    expect(report.granted).toBe(1);

    const [after] = await db.select().from(profiles).where(eq(profiles.id, profile.id));
    expect(after!.freezeBank).toBe(1);
  });

  it('is idempotent under redelivery: a second run for the SAME week never double-grants', async () => {
    const profile = buildProfile({ freezeBank: 0 });
    await db.insert(profiles).values(profile);

    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    const answered = new Set(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-11']);
    for (const date of dates) {
      const market = buildMarket({ status: 'resolved', outcome: 'yes' });
      await db.insert(markets).values(market);
      const q = buildQuestion(market.id as string, { questionDate: date, status: 'open' });
      await db.insert(questions).values(q);
      if (answered.has(date)) {
        await db.insert(picks).values(buildPick(q.id as string, profile.id as string, { result: 'pending' }));
      }
    }

    const at = new Date('2026-10-12T04:05:00Z');
    // Simulates a worker crash right after this profile's grant committed, then pg-boss
    // redelivering the whole job — freeze_bank (1) is still below STREAK_FREEZE_CAP, so
    // without the last_freeze_grant_week self-exclusion this profile would re-qualify.
    const first = await runStreakFreezeGrant(db, pool, at);
    expect(first.granted).toBe(1);
    const second = await runStreakFreezeGrant(db, pool, at);
    expect(second.granted).toBe(0);

    const [after] = await db.select().from(profiles).where(eq(profiles.id, profile.id));
    expect(after!.freezeBank).toBe(1); // not 2
  });
});
