/**
 * WS6-T2 integration AC (§19.3 WS6-T2 row): "6-question match E2E with mock grading; synergy
 * display gate" — against a real Postgres + Redis + pg-boss.
 *
 *   - Test A drives a full 6-question duo match (3 daily via `reveal:fire`, 3 `duo_bonus` via
 *     `grade:followup`) through the SAME hooks this task wired into the real grading pipeline,
 *     asserting the match completes with the correct §8.9 score/winner and that chemistry gets
 *     computed as a side effect.
 *   - Test B isolates the SYNERGY_MIN_PICKS gate (§8.9) across two matches' worth of lifetime
 *     slots, calling `tryCompleteDuoMatch` directly (the same function Test A's hooks call) so
 *     it doesn't need to re-drive the whole publication pipeline just to control slot counts
 *     precisely.
 *   - Test C isolates void-question exclusion (§8.9's "voids create no slot" / scoring
 *     exclusion) the same direct way.
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test) and Redis via TEST_REDIS_URL,
 * mirroring every other integration test's fallback default exactly.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import { SYNERGY_MIN_PICKS } from '@receipts/core';
import {
  connect,
  duoMatchQuestions,
  duoMatches,
  duos,
  markets,
  picks,
  profiles,
  questions,
  revealQuestionTx,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildProfile, computeEdge } from '@receipts/db/testing';
import { runGradeFollowup } from '../../src/jobs/grade-followup.js';
import { settleQuestion } from '../../src/lib/settle-question.js';
import { tryCompleteDuoMatch } from '../../src/jobs/duo-match-completion.js';

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

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE duo_match_questions, duo_matches, duos, picks, questions, markets, profiles, notifications RESTART IDENTITY CASCADE`,
  );
  await db.execute(sql`DELETE FROM pgboss.job`);
});

async function makeClaimedProfile(): Promise<ProfileRow> {
  const row = buildProfile({ kind: 'claimed', status: 'active' });
  const [inserted] = await db.insert(profiles).values(row).returning();
  return inserted!;
}

async function makeDuo(memberAId: string, memberBId: string): Promise<string> {
  const id = uuidv7();
  await db.insert(duos).values({
    id,
    profileAId: memberAId < memberBId ? memberAId : memberBId,
    profileBId: memberAId < memberBId ? memberBId : memberAId,
    status: 'active',
    tier: 1,
    glickoRating: 1500,
    glickoRd: 350,
  });
  return id;
}

interface PickSpec {
  profileId: string;
  won: boolean; // side is derived: won → 'yes' (outcome is always 'yes' in this file)
}

/** A `locked`, settled-but-not-yet-revealed question with picks — mirrors
 * `grading-streaks-reveal.test.ts`'s `insertGradedDaily` helper, generalized to both `daily`
 * and `duo_bonus` kinds (this task's AC exercises both hook paths, §8.8.1). */
async function insertLockedGradedQuestion(opts: {
  kind: 'daily' | 'duo_bonus';
  questionDate?: string | null;
  settledAt: Date;
  picksSpec: PickSpec[];
}): Promise<string> {
  const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
  const questionId = uuidv7();
  await db.insert(questions).values({
    id: questionId,
    kind: opts.kind,
    marketId: market!.id,
    questionDate: opts.kind === 'daily' ? opts.questionDate! : null,
    slug: `${opts.kind}-${questionId}`,
    headline: 'Test question',
    yesLabel: 'Yes',
    noLabel: 'No',
    openAt: new Date(opts.settledAt.getTime() - 6 * 3600_000),
    lockAt: new Date(opts.settledAt.getTime() - 3600_000),
    revealAt: opts.settledAt,
    status: 'locked',
    outcome: 'yes',
    settledAt: opts.settledAt,
  });
  for (const p of opts.picksSpec) {
    const side = p.won ? 'yes' : 'no';
    await db.insert(picks).values({
      id: uuidv7(),
      questionId,
      profileId: p.profileId,
      side,
      yesPriceAtEntry: 0.5,
      priceStampedAt: opts.settledAt,
      result: p.won ? 'win' : 'loss',
      edge: computeEdge(side, 0.5, p.won),
    });
  }
  return questionId;
}

describe('duo match lifecycle — 6-question E2E (§8.9, §19.3 WS6-T2 AC)', () => {
  it('completes with the correct §8.9 score/winner once all 6 questions grade, via the real reveal/grade-followup hooks', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id);
    const duoBId = await makeDuo(b1.id, b2.id);
    const matchId = uuidv7();
    await db.insert(duoMatches).values({
      id: matchId,
      duoAId,
      duoBId,
      windowStart: '2026-07-21',
      windowEnd: '2026-07-23',
      status: 'active',
    });

    // 4 win/loss combos across the two duos' four members, spread over 3 daily + 3 duo_bonus
    // questions (§19.3 AC wording) — duoA: 2/1/0/2/1/0 = 6 pts; duoB: 0/2/0/0/1/0 = 3 pts.
    const q1 = await insertLockedGradedQuestion({
      kind: 'daily',
      questionDate: '2026-07-21',
      settledAt: new Date('2026-07-21T17:00:00Z'),
      picksSpec: [
        { profileId: a1.id, won: true },
        { profileId: a2.id, won: true },
        { profileId: b1.id, won: false },
      ],
    });
    const q2 = await insertLockedGradedQuestion({
      kind: 'daily',
      questionDate: '2026-07-22',
      settledAt: new Date('2026-07-22T17:00:00Z'),
      picksSpec: [
        { profileId: a1.id, won: true },
        { profileId: b1.id, won: true },
        { profileId: b2.id, won: true },
      ],
    });
    const q3 = await insertLockedGradedQuestion({
      kind: 'daily',
      questionDate: '2026-07-23',
      settledAt: new Date('2026-07-23T17:00:00Z'),
      picksSpec: [
        { profileId: a1.id, won: false },
        { profileId: a2.id, won: false },
        { profileId: b1.id, won: false },
      ],
    });
    const q4 = await insertLockedGradedQuestion({
      kind: 'duo_bonus',
      settledAt: new Date('2026-07-21T18:00:00Z'),
      picksSpec: [
        { profileId: a1.id, won: true },
        { profileId: a2.id, won: true },
        { profileId: b1.id, won: false },
        { profileId: b2.id, won: false },
      ],
    });
    const q5 = await insertLockedGradedQuestion({
      kind: 'duo_bonus',
      settledAt: new Date('2026-07-22T18:00:00Z'),
      picksSpec: [
        { profileId: a2.id, won: true },
        { profileId: b1.id, won: true },
      ],
    });
    const q6 = await insertLockedGradedQuestion({
      kind: 'duo_bonus',
      settledAt: new Date('2026-07-23T18:00:00Z'),
      picksSpec: [
        { profileId: a1.id, won: false },
        { profileId: b1.id, won: false },
        { profileId: b2.id, won: false },
      ],
    });
    await db.insert(duoMatchQuestions).values([
      { matchId, questionId: q4 },
      { matchId, questionId: q5 },
      { matchId, questionId: q6 },
    ]);

    // Bonus questions publish immediately (§8.8.1) — order doesn't matter.
    await runGradeFollowup(db, pool, redis, q4);
    await runGradeFollowup(db, pool, redis, q5);
    await runGradeFollowup(db, pool, redis, q6);

    // Dailies must reveal in date order (§6.6 ordering assert) — the match should NOT complete
    // until the last one (q3) reveals, even though every bonus question already has.
    await settleQuestion(db, pool, q1);
    let mid = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(mid[0]!.status).toBe('active');

    await settleQuestion(db, pool, q2);
    mid = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(mid[0]!.status).toBe('active');

    await settleQuestion(db, pool, q3);

    const [finalMatch] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(finalMatch!.status).toBe('completed');
    expect(finalMatch!.scoreA).toBe(6);
    expect(finalMatch!.scoreB).toBe(3);
    expect(finalMatch!.winnerDuoId).toBe(duoAId);
    expect(finalMatch!.ratingAppliedAt).toBeNull(); // §8.3: deferred to the weekly batch, not applied here

    const [finalDuoA] = await db.select().from(duos).where(eq(duos.id, duoAId));
    const [finalDuoB] = await db.select().from(duos).where(eq(duos.id, duoBId));
    expect(finalDuoA!.matchesPlayed).toBe(1);
    expect(finalDuoB!.matchesPlayed).toBe(1);
    // Chemistry got computed as a side effect (11 total slots < SYNERGY_MIN_PICKS for either
    // duo in THIS match alone — the precise gate boundary is Test B's job).
    expect(finalDuoA!.jointHitRate).not.toBeNull();
    expect(finalDuoB!.jointHitRate).not.toBeNull();
  });
});

describe('duo chemistry — synergy display gate (§8.9, §19.3 WS6-T2 AC)', () => {
  it('leaves synergy null below SYNERGY_MIN_PICKS lifetime slots, then populates it once the threshold is met', async () => {
    const [a1, a2, b1, b2, d1, d2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id);
    const duoBId = await makeDuo(b1.id, b2.id);

    // Match 1: duoA gets 11 lifetime slots (5 questions with BOTH members picking = 10, plus 1
    // question with only a1 picking = 1) — one short of SYNERGY_MIN_PICKS (12).
    const match1Id = uuidv7();
    await db.insert(duoMatches).values({
      id: match1Id,
      duoAId,
      duoBId,
      windowStart: '2026-07-21',
      windowEnd: '2026-07-23',
      status: 'active',
    });
    const match1QuestionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const qid = await insertLockedGradedQuestion({
        kind: 'duo_bonus',
        settledAt: new Date(`2026-07-21T1${i}:00:00Z`),
        picksSpec: [
          { profileId: a1.id, won: i % 2 === 0 },
          { profileId: a2.id, won: i % 2 === 1 },
          { profileId: b1.id, won: true },
        ],
      });
      match1QuestionIds.push(qid);
    }
    const q6Match1 = await insertLockedGradedQuestion({
      kind: 'duo_bonus',
      settledAt: new Date('2026-07-21T19:00:00Z'),
      picksSpec: [{ profileId: a1.id, won: true }], // a2 does NOT pick — 1 slot, not 2
    });
    match1QuestionIds.push(q6Match1);
    await db.insert(duoMatchQuestions).values(match1QuestionIds.map((questionId) => ({ matchId: match1Id, questionId })));
    for (const qid of match1QuestionIds) {
      await runGradeFollowup(db, pool, redis, qid);
    }

    const [duoAAfterMatch1] = await db.select().from(duos).where(eq(duos.id, duoAId));
    expect(duoAAfterMatch1!.synergy).toBeNull();
    expect(duoAAfterMatch1!.jointHitRate).not.toBeNull(); // §8.9: joint_hit_rate isn't gated, only synergy is

    // Match 2: duoA vs a fresh duoD — exactly ONE more graded slot for duoA (only a1 picks the
    // one bonus question that's actually graded; the rest get no duoA picks at all), pushing
    // duoA's LIFETIME total from 11 to SYNERGY_MIN_PICKS (12) exactly.
    const duoDId = await makeDuo(d1.id, d2.id);
    const match2Id = uuidv7();
    await db.insert(duoMatches).values({
      id: match2Id,
      duoAId,
      duoBId: duoDId,
      windowStart: '2026-07-24',
      windowEnd: '2026-07-26',
      status: 'active',
    });
    const match2QuestionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const qid = await insertLockedGradedQuestion({
        kind: 'duo_bonus',
        settledAt: new Date(`2026-07-24T1${i}:00:00Z`),
        picksSpec: [{ profileId: d1.id, won: true }], // no a1/a2 picks at all — 0 duoA slots
      });
      match2QuestionIds.push(qid);
    }
    const lastQMatch2 = await insertLockedGradedQuestion({
      kind: 'duo_bonus',
      settledAt: new Date('2026-07-24T19:00:00Z'),
      picksSpec: [{ profileId: a1.id, won: false }], // exactly 1 new duoA slot
    });
    match2QuestionIds.push(lastQMatch2);
    await db.insert(duoMatchQuestions).values(match2QuestionIds.map((questionId) => ({ matchId: match2Id, questionId })));
    for (const qid of match2QuestionIds) {
      await runGradeFollowup(db, pool, redis, qid);
    }

    const [duoAAfterMatch2] = await db.select().from(duos).where(eq(duos.id, duoAId));
    expect(SYNERGY_MIN_PICKS).toBe(12); // pin the constant this test's arithmetic assumes
    expect(duoAAfterMatch2!.synergy).not.toBeNull();
    expect(typeof duoAAfterMatch2!.synergy).toBe('number');
  });
});

describe('duo match scoring — void exclusion (§8.9)', () => {
  it('excludes a voided question from scoring but still completes on the rest', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id);
    const duoBId = await makeDuo(b1.id, b2.id);
    const matchId = uuidv7();
    await db.insert(duoMatches).values({
      id: matchId,
      duoAId,
      duoBId,
      windowStart: '2026-07-21',
      windowEnd: '2026-07-23',
      status: 'active',
    });

    // One revealed question duoA would otherwise win... `insertLockedGradedQuestion` only takes
    // it to `locked` (mirroring the real pipeline's intermediate state) — reveal it directly
    // here since this test calls `tryCompleteDuoMatch` directly rather than going through
    // `grade:followup`/`reveal:fire` (Test A already covers that wiring end-to-end).
    const winQ = await insertLockedGradedQuestion({
      kind: 'duo_bonus',
      settledAt: new Date('2026-07-21T18:00:00Z'),
      picksSpec: [
        { profileId: a1.id, won: true },
        { profileId: b1.id, won: false },
      ],
    });
    await revealQuestionTx(db, winQ, new Date('2026-07-21T18:05:00Z'));
    // ...and one VOIDED question with picks that would have flipped the result if counted.
    const [voidMarket] = await db.insert(markets).values(buildMarket({ status: 'voided' })).returning();
    const voidQId = uuidv7();
    await db.insert(questions).values({
      id: voidQId,
      kind: 'duo_bonus',
      marketId: voidMarket!.id,
      questionDate: null,
      slug: `duo-bonus-void-${voidQId}`,
      headline: 'Voided',
      yesLabel: 'Yes',
      noLabel: 'No',
      openAt: new Date('2026-07-21T10:00:00Z'),
      lockAt: new Date('2026-07-21T12:00:00Z'),
      revealAt: new Date('2026-07-21T12:00:00Z'),
      status: 'voided',
      voidReason: 'test_void',
    });
    await db.insert(picks).values([
      {
        id: uuidv7(),
        questionId: voidQId,
        profileId: b1.id,
        side: 'yes',
        yesPriceAtEntry: 0.5,
        priceStampedAt: new Date('2026-07-21T10:30:00Z'),
        result: 'void',
        edge: null,
      },
    ]);

    await db.insert(duoMatchQuestions).values([
      { matchId, questionId: winQ },
      { matchId, questionId: voidQId },
    ]);

    const result = await tryCompleteDuoMatch(db, matchId, new Date('2026-07-21T19:00:00Z'));

    expect(result.completed).toBe(true);
    expect(result.scoreA).toBe(1); // only from winQ — voidQ contributed nothing either way
    expect(result.scoreB).toBe(0);
    expect(result.winner).toBe('a');
  });
});
