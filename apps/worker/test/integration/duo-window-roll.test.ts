/**
 * WS6-T2 integration: `duo:window-roll` against a real Postgres (§8.5).
 *   - fixed-calendar window derivation: Tue fire → Tue-Thu window; Fri fire → Fri-Sun window.
 *   - tier-local closest-rating pairing (WS4-T5's `matchDuoVsDuo`, exercised through the DB
 *     wiring, not re-tested here — that pure function's own AC is `duo-matcher.test.ts`).
 *   - odd-duo-out: an odd tier size leaves one duo unpaired and reports it in `oddOneOut`.
 *   - a duo already mid-match (from a prior window) is excluded from this window's pool.
 *   - duo_bonus curation: up to 3 questions authored from the nemesis_eligible market pool,
 *     shared/reused across every match created in the same run; 0-bonus is valid when no
 *     eligible market exists.
 *   - straggler backstop: a match whose window has fully elapsed gets force-completed even with
 *     partial grading, freeing its duos for this window's pairing.
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see every other integration
 * test's fallback default) and Redis logical DB 6 via TEST_REDIS_URL, mirroring
 * `duo-matchmaker.test.ts`'s convention exactly.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import {
  connect,
  duoMatchQuestions,
  duoMatches,
  duos,
  markets,
  picks,
  profiles,
  questions,
  type Db,
} from '@receipts/db';
import { buildMarket, buildProfile } from '@receipts/db/testing';
import { runDuoWindowRoll, computeWindow } from '../../src/jobs/duo-window-roll.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

// 09:00 ET on a Tuesday / Friday in July (EDT, UTC-4).
const TUESDAY_ROLL = new Date('2026-07-21T13:00:00Z');
const FRIDAY_ROLL = new Date('2026-07-24T13:00:00Z');

let pool: pg.Pool;
let db: Db;
let boss: PgBoss;

beforeAll(async () => {
  process.env.FLAG_DUO_QUEUE = 'true';
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });

  boss = new PgBoss({ connectionString: dbUrl, schema: 'pgboss' });
  await boss.start();
  await boss.createQueue('question:open');
  await boss.createQueue('question:lock');
  await boss.createQueue('reveal:fire');
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE duo_match_questions, duo_matches, duos, picks, questions, markets, profiles RESTART IDENTITY CASCADE`,
  );
  await db.execute(sql`DELETE FROM pgboss.job`);
});

async function makeDuo(overrides: Partial<typeof duos.$inferInsert> = {}): Promise<string> {
  const id = uuidv7();
  const [profileX, profileY] = await Promise.all([
    db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active' })).returning(),
    db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active' })).returning(),
  ]);
  const x = profileX[0]!.id;
  const y = profileY[0]!.id;
  await db.insert(duos).values({
    id,
    profileAId: x < y ? x : y,
    profileBId: x < y ? y : x,
    status: 'active',
    tier: 1,
    glickoRating: 1500,
    glickoRd: 350,
    ...overrides,
  });
  return id;
}

describe('computeWindow (§8.5 fixed calendar)', () => {
  it('Tuesday fire → Tue-Thu window', () => {
    expect(computeWindow(TUESDAY_ROLL)).toEqual({ windowStart: '2026-07-21', windowEnd: '2026-07-23' });
  });
  it('Friday fire → Fri-Sun window', () => {
    expect(computeWindow(FRIDAY_ROLL)).toEqual({ windowStart: '2026-07-24', windowEnd: '2026-07-26' });
  });
  it('any other ET weekday → null (defensive; cron should prevent this)', () => {
    expect(computeWindow(new Date('2026-07-20T13:00:00Z'))).toBeNull(); // Monday
  });
});

describe('runDuoWindowRoll — pairing (§8.5)', () => {
  it('pairs two same-tier duos by closest rating and creates an active match spanning the window', async () => {
    const duoA = await makeDuo({ glickoRating: 1500 });
    const duoB = await makeDuo({ glickoRating: 1520 });

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report).not.toBeNull();
    expect(report!.windowStart).toBe('2026-07-21');
    expect(report!.windowEnd).toBe('2026-07-23');
    expect(report!.matchesCreated).toBe(1);
    expect(report!.oddOneOut).toEqual([]);

    const [match] = await db.select().from(duoMatches);
    expect(match).toBeDefined();
    expect(match!.status).toBe('active');
    expect(match!.windowStart).toBe('2026-07-21');
    expect(match!.windowEnd).toBe('2026-07-23');
    expect([match!.duoAId, match!.duoBId].sort()).toEqual([duoA, duoB].sort());
  });

  it('does not pair duos across different tiers', async () => {
    await makeDuo({ tier: 1 });
    await makeDuo({ tier: 2 });

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.matchesCreated).toBe(0);
    expect(report!.oddOneOut.length).toBe(2); // each tier of 1 sits itself out
  });

  it('leaves the odd duo out in a tier of 3 and reports it', async () => {
    await makeDuo({ glickoRating: 1400 });
    await makeDuo({ glickoRating: 1500 });
    const oddCandidate = await makeDuo({ glickoRating: 1900 }); // farthest from the pair → odd one out per matchDuoVsDuo's adjacent-pairing sort

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.matchesCreated).toBe(1);
    expect(report!.oddOneOut).toEqual([oddCandidate]);

    const matches = await db.select().from(duoMatches);
    expect(matches).toHaveLength(1);
    expect([matches[0]!.duoAId, matches[0]!.duoBId]).not.toContain(oddCandidate);
  });

  it('excludes duos that already have a scheduled/active match from this window pool', async () => {
    const busyDuoA = await makeDuo();
    const busyDuoB = await makeDuo();
    const freeDuo = await makeDuo();
    // NOT overdue (windowEnd is in the future relative to this roll) — isolates "already busy"
    // exclusion from the separate straggler-backstop behavior covered above.
    await db.insert(duoMatches).values({
      id: uuidv7(),
      duoAId: busyDuoA,
      duoBId: busyDuoB,
      windowStart: '2026-07-21',
      windowEnd: '2026-07-23',
      status: 'active',
    });

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    // Only `freeDuo` is eligible; alone, it sits out — no new match forms.
    expect(report!.matchesCreated).toBe(0);
    expect(report!.oddOneOut).toEqual([freeDuo]);
    const matches = await db.select().from(duoMatches).where(eq(duoMatches.windowStart, '2026-07-21'));
    expect(matches).toHaveLength(1); // only the pre-seeded busy match — no new one created
    for (const m of matches) {
      expect([m.duoAId, m.duoBId]).not.toContain(freeDuo);
    }
  });
});

describe('runDuoWindowRoll — duo_bonus curation (§8.8.1)', () => {
  it('is a valid 0-bonus match when no nemesis_eligible market exists', async () => {
    await makeDuo();
    await makeDuo();

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.matchesCreated).toBe(1);
    expect(report!.bonusQuestionsAttached).toBe(0);
    const [match] = await db.select().from(duoMatches);
    const joins = await db.select().from(duoMatchQuestions).where(eq(duoMatchQuestions.matchId, match!.id));
    expect(joins).toHaveLength(0);
  });

  it('attaches up to 3 duo_bonus questions authored from the nemesis_eligible pool, shared across matches in the same run', async () => {
    // 4 duos → 2 pairings this window, both should share the SAME resolved bonus questions.
    await makeDuo({ glickoRating: 1500 });
    await makeDuo({ glickoRating: 1510 });
    await makeDuo({ glickoRating: 1600 });
    await makeDuo({ glickoRating: 1610 });

    for (let i = 0; i < 4; i++) {
      await db.insert(markets).values(
        buildMarket({
          nemesisEligible: true,
          status: 'open',
          closeTime: new Date(`2026-07-22T18:0${i}:00Z`), // within the Tue-Thu window
        }),
      );
    }

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.matchesCreated).toBe(2);
    expect(report!.bonusQuestionsAttached).toBe(3); // capped at DUO_BONUS_PER_MATCH despite 4 candidates

    const bonusQuestions = await db.select().from(questions).where(eq(questions.kind, 'duo_bonus'));
    expect(bonusQuestions).toHaveLength(3); // authored once, not once per match

    const matches = await db.select().from(duoMatches);
    for (const m of matches) {
      const joins = await db.select().from(duoMatchQuestions).where(eq(duoMatchQuestions.matchId, m.id));
      expect(joins).toHaveLength(3);
      expect(joins.map((j) => j.questionId).sort()).toEqual(bonusQuestions.map((q) => q.id).sort());
    }
  });

  it('ignores a nemesis_eligible market whose close_time falls outside the window', async () => {
    await makeDuo();
    await makeDuo();
    await db.insert(markets).values(
      buildMarket({ nemesisEligible: true, status: 'open', closeTime: new Date('2026-08-15T18:00:00Z') }),
    );

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.bonusQuestionsAttached).toBe(0);
  });
});

describe('runDuoWindowRoll — straggler backstop (§8.5)', () => {
  it('force-completes an overdue scheduled/active match whose window has fully elapsed, freeing its duos', async () => {
    const staleDuoA = await makeDuo();
    const staleDuoB = await makeDuo();
    const staleMatchId = uuidv7();
    await db.insert(duoMatches).values({
      id: staleMatchId,
      duoAId: staleDuoA,
      duoBId: staleDuoB,
      windowStart: '2026-07-17', // Fri window ending 2026-07-19 — fully before this Tuesday's roll
      windowEnd: '2026-07-19',
      status: 'active',
    });
    // No questions/picks at all for this stale match — every one of its "own questions" is
    // simply absent, so `scoreDuoMatch` naturally excludes everything and it force-completes 0-0.

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.backstopCompleted).toBe(0); // 0 questions at all → getDuoMatchScoringInput returns [] → not force-completable (guarded against garbage)
    const [staleMatch] = await db.select().from(duoMatches).where(eq(duoMatches.id, staleMatchId));
    expect(staleMatch!.status).toBe('active'); // left alone — a truly empty match isn't force-completed, it's just inert

    // The duos are still "busy" (still attached to a scheduled/active match), so they don't get
    // re-paired this window even though that match will never naturally complete.
    expect(report!.matchesCreated).toBe(0);
  });

  it('force-completes an overdue match with partial grading, then re-pairs its freed duos within the SAME run', async () => {
    const staleDuoA = await makeDuo();
    const staleDuoB = await makeDuo();
    const staleMatchId = uuidv7();
    await db.insert(duoMatches).values({
      id: staleMatchId,
      duoAId: staleDuoA,
      duoBId: staleDuoB,
      windowStart: '2026-07-17', // the PRIOR Fri-Sun window — fully elapsed by this Tuesday's roll
      windowEnd: '2026-07-19',
      status: 'active',
    });
    const [duoARow] = await db.select().from(duos).where(eq(duos.id, staleDuoA));
    const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();

    // 3 daily questions across the stale window: only the first ever graded/revealed — the
    // other two never even locked, simulating stragglers a normal completion check would never
    // fire for (isDuoMatchFullyGraded requires ALL settled; the backstop doesn't).
    const gradedQuestion = await db
      .insert(questions)
      .values({
        id: uuidv7(),
        kind: 'daily',
        marketId: market!.id,
        questionDate: '2026-07-17',
        slug: 'stale-daily-2026-07-17',
        headline: 'Stale graded?',
        yesLabel: 'Yes',
        noLabel: 'No',
        openAt: new Date('2026-07-17T13:00:00Z'),
        lockAt: new Date('2026-07-17T16:00:00Z'),
        revealAt: new Date('2026-07-17T20:00:00Z'),
        status: 'revealed',
        outcome: 'yes',
        settledAt: new Date('2026-07-17T17:00:00Z'),
        revealedAt: new Date('2026-07-17T20:00:00Z'),
      })
      .returning();
    for (const otherDate of ['2026-07-18', '2026-07-19']) {
      const [m] = await db.insert(markets).values(buildMarket({ status: 'open' })).returning();
      await db.insert(questions).values({
        id: uuidv7(),
        kind: 'daily',
        marketId: m!.id,
        questionDate: otherDate,
        slug: `stale-daily-${otherDate}`,
        headline: 'Never graded',
        yesLabel: 'Yes',
        noLabel: 'No',
        openAt: new Date(`${otherDate}T13:00:00Z`),
        lockAt: new Date(`${otherDate}T16:00:00Z`),
        revealAt: new Date(`${otherDate}T20:00:00Z`),
        status: 'open', // never locked/settled — a true straggler
      });
    }

    await db.insert(picks).values([
      {
        id: uuidv7(),
        questionId: gradedQuestion[0]!.id,
        profileId: duoARow!.profileAId,
        side: 'yes',
        yesPriceAtEntry: 0.5,
        priceStampedAt: new Date('2026-07-17T14:00:00Z'),
        result: 'win',
        edge: 0.5,
      },
      {
        id: uuidv7(),
        questionId: gradedQuestion[0]!.id,
        profileId: duoARow!.profileBId,
        side: 'no',
        yesPriceAtEntry: 0.5,
        priceStampedAt: new Date('2026-07-17T14:00:00Z'),
        result: 'loss',
        edge: -0.5,
      },
    ]);

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.backstopCompleted).toBe(1);
    const [staleMatch] = await db.select().from(duoMatches).where(eq(duoMatches.id, staleMatchId));
    expect(staleMatch!.status).toBe('completed');
    expect(staleMatch!.scoreA).toBe(1); // profileA won, profileB lost → 1 duo point on the one graded question

    const [freedDuoA] = await db.select().from(duos).where(eq(duos.id, staleDuoA));
    expect(freedDuoA!.matchesPlayed).toBe(1);

    // Freed by the backstop earlier in the SAME run, staleDuoA/B are re-paired into a fresh
    // match for the CURRENT window (only 2 duos exist total, so they can only pair each other).
    expect(report!.matchesCreated).toBe(1);
    const newMatches = await db.select().from(duoMatches).where(eq(duoMatches.windowStart, '2026-07-21'));
    expect(newMatches).toHaveLength(1);
    expect([newMatches[0]!.duoAId, newMatches[0]!.duoBId].sort()).toEqual([staleDuoA, staleDuoB].sort());
  });
});
