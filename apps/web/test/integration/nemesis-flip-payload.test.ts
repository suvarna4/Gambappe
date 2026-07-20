/**
 * SW10-T1 (wiring-gaps doc §4 SW10-T1): `viewer.nemesis_flip` emission — the REAL
 * `buildRevealPayload` against really-seeded Postgres, matching `broken-run-payload.test.ts`'s
 * (SW9-T1) own binding rule: real `nemesis_pairings`/`questions`/`picks` rows, no hand-built
 * payload shapes.
 *
 * Covers:
 *  - the mechanical emission condition (no pairing -> null; pairing but opponent hasn't picked
 *    -> null; both picked -> populated; viewer no-pick/void -> the whole `viewer` block is
 *    absent, the "impossible state" case);
 *  - tally correctness: `you_wins`/`opponent_wins` come from a scoreboard replay, NOT
 *    `nemesis_pairings.score_a`/`score_b` (seeded at 0 here to prove it — those columns are
 *    only written at week conclusion);
 *  - the `nemesis` flag gate;
 *  - the "structurally unreachable pre-reveal" guarantee: a `locked` (not yet `revealed`)
 *    question with a REAL opponent pick already sitting in Postgres still throws before any
 *    viewer content (nemesis or otherwise) is assembled — `buildRevealPayload`'s very first
 *    statement gates on `question.status`, before touching a single pick row.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  getMarketById,
  getQuestionById,
  markets,
  nemesisPairings,
  picks,
  profiles,
  questions,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildNemesisPairing, buildPick, buildProfile, buildQuestion, buildSeason, computeEdge } from '@receipts/db/testing';
import { buildRevealPayload } from '@/lib/reveal-payload';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

const WEEK_START = '2026-07-13'; // a Monday

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

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE pairing_questions, nemesis_pairings, picks, questions, markets, profiles, seasons RESTART IDENTITY CASCADE`,
  );
});

const ORIGINAL_FLAG_NEMESIS = process.env.FLAG_NEMESIS;

beforeEach(() => {
  process.env.FLAG_NEMESIS = 'true';
});

afterEach(() => {
  process.env.FLAG_NEMESIS = ORIGINAL_FLAG_NEMESIS;
});

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const [row] = await db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active', ...overrides })).returning();
  return row!;
}

async function makeSeasonRow(): Promise<string> {
  const [row] = await db.insert(seasons).values(buildSeason({ startsOn: WEEK_START, endsOn: '2026-09-28' })).returning();
  return row!.id;
}

async function makePairing(
  seasonId: string,
  profileAId: string,
  profileBId: string,
  overrides: Partial<typeof nemesisPairings.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await db
    .insert(nemesisPairings)
    .values(buildNemesisPairing(seasonId, profileAId, profileBId, { weekStart: WEEK_START, status: 'active', ...overrides }))
    .returning();
  return inserted!.id;
}

/** A real, revealed `daily` question anchored `dayOffset` days into `WEEK_START..+6`. */
async function makeRevealedDailyQuestion(
  dayOffset: number,
  overrides: Partial<typeof questions.$inferInsert> = {},
): Promise<string> {
  const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
  const d = new Date(`${WEEK_START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const dateStr = d.toISOString().slice(0, 10);
  const revealedAt = new Date(`${dateStr}T20:00:00Z`);
  const [inserted] = await db
    .insert(questions)
    .values(
      buildQuestion(market!.id as string, {
        kind: 'daily',
        questionDate: dateStr,
        slug: `${dateStr}-nemesis-flip-test-${uuidv7()}`,
        status: 'revealed',
        outcome: 'yes',
        lockAt: new Date(`${dateStr}T16:00:00Z`),
        settledAt: revealedAt,
        revealedAt,
        crowdYesAtLock: 6,
        crowdNoAtLock: 4,
        ...overrides,
      }),
    )
    .returning();
  return inserted!.id;
}

async function makePick(
  questionId: string,
  profileId: string,
  overrides: Partial<typeof picks.$inferInsert> = {},
): Promise<void> {
  await db.insert(picks).values(buildPick(questionId, profileId, overrides));
}

async function getPayloadFor(questionId: string, viewerProfileId: string) {
  const question = await getQuestionById(db, questionId);
  const market = await getMarketById(db, question!.marketId);
  return buildRevealPayload({
    db,
    redis,
    question: question!,
    market: market!,
    viewerProfileId,
    appUrl: 'https://receipts.example',
    at: new Date(`${question!.questionDate}T20:05:00Z`),
  });
}

describe('buildRevealPayload — nemesis_flip mechanical condition (SW10-T1)', () => {
  it('is null when the viewer has no active nemesis pairing', async () => {
    const viewer = await makeClaimedProfile();
    const qId = await makeRevealedDailyQuestion(0);
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer).toBeDefined();
    expect(payload.viewer!.nemesis_flip).toBeNull();
  });

  it("is null when there's an active pairing but the opponent has not picked this question", async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    const qId = await makeRevealedDailyQuestion(0);
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    // No pick from `opponent` on this question.

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer!.nemesis_flip).toBeNull();
  });

  it('is populated when both the viewer and the opponent have picked', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([
      makeClaimedProfile({ handle: 'Viewer H.' }),
      makeClaimedProfile({ handle: 'Opponent H.' }),
    ]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    const qId = await makeRevealedDailyQuestion(0, { yesLabel: 'Yes it will', noLabel: 'No it will not' });
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, opponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    const flip = payload.viewer!.nemesis_flip;
    expect(flip).not.toBeNull();
    expect(flip!.opponent_handle).toBe('Opponent H.');
    expect(flip!.opponent_side).toBe('no');
    expect(flip!.opponent_side_label).toBe('No it will not');
    expect(flip!.opponent_entry_cents).toBe(40); // side=no, yesPriceAtEntry=0.6 -> 1-0.6=0.4 -> 40c
  });

  it('viewer no-pick: the whole `viewer` block is absent, hence no flip block (impossible-state case)', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    const qId = await makeRevealedDailyQuestion(0);
    await makePick(qId, opponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });
    // Viewer never picked at all.

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer).toBeUndefined();
  });

  it('viewer void pick: the whole `viewer` block is absent, hence no flip block (impossible-state case)', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    const qId = await makeRevealedDailyQuestion(0);
    await makePick(qId, viewer.id, { side: 'yes', result: 'void', edge: 0, yesPriceAtEntry: 0.6 });
    await makePick(qId, opponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer).toBeUndefined();
  });

  it('is null when the `nemesis` flag is off, even with an active pairing and a mutual pick', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    const qId = await makeRevealedDailyQuestion(0);
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, opponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    process.env.FLAG_NEMESIS = 'false';
    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer!.nemesis_flip).toBeNull();
    // Byte-identical-otherwise: the rest of the viewer block is completely unaffected.
    expect(payload.viewer!.result).toBe('win');
  });

  it('is null for a mutually-picked question outside the pairing\'s current week (fable round 2 of PR #85)', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    // A daily question dated a full week before `WEEK_START` — outside this pairing's
    // `weekStart..weekEnd` range, so `getPairingScoreboardQuestions`'s own SQL (the daily-date
    // BETWEEN clause, OR an explicit `pairing_questions` bonus row) never includes it. Both the
    // viewer and the opponent happen to have picked it too (e.g. reached via an archival reveal
    // link) — mechanically satisfying "opponent has a pick on this question" while it's not
    // actually a row on this week's scoreboard at all.
    const lastWeekQuestion = await makeRevealedDailyQuestion(-7);
    await makePick(lastWeekQuestion, viewer.id, {
      side: 'yes',
      result: 'win',
      edge: computeEdge('yes', 0.6, true),
      yesPriceAtEntry: 0.6,
    });
    await makePick(lastWeekQuestion, opponent.id, {
      side: 'no',
      result: 'loss',
      edge: computeEdge('no', 0.6, false),
      yesPriceAtEntry: 0.6,
    });

    const payload = await getPayloadFor(lastWeekQuestion, viewer.id);
    expect(payload.viewer!.nemesis_flip).toBeNull();
    // The rest of the viewer block still reflects the archival reveal normally.
    expect(payload.viewer!.result).toBe('win');
  });
});

describe('buildRevealPayload — nemesis_flip tally correctness (SW10-T1, fable round 5 HIGH finding)', () => {
  it('derives you_wins/opponent_wins from a scoreboard replay, NOT the zeroed pairing.score_a/score_b columns', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    // Deliberately left at 0 (simulating pre-conclusion state — these columns are only written
    // by nemesis:conclude at week end) to prove the emitted tally does NOT come from here.
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    // Day0: viewer wins. Day1: opponent wins. Day2 (today's reveal): viewer wins again.
    // Real tally: viewer 2, opponent 1.
    const day0 = await makeRevealedDailyQuestion(0);
    await makePick(day0, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(day0, opponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const day1 = await makeRevealedDailyQuestion(1);
    await makePick(day1, viewer.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });
    await makePick(day1, opponent.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });

    const day2 = await makeRevealedDailyQuestion(2);
    await makePick(day2, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(day2, opponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(day2, viewer.id);
    const flip = payload.viewer!.nemesis_flip;
    expect(flip).not.toBeNull();
    expect(flip!.you_wins).toBe(2);
    expect(flip!.opponent_wins).toBe(1);
    // If this had read `pairing.score_a`/`score_b` instead, it would print 0-0.
    expect([flip!.you_wins, flip!.opponent_wins]).not.toEqual([0, 0]);
  });
});

describe('buildRevealPayload — nemesis_flip is structurally unreachable pre-reveal (SW10-T1)', () => {
  it('throws before assembling any viewer content for a `locked` question, even with a REAL opponent pick already in Postgres', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, opponent] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, viewer.id, opponent.id, { scoreA: 0, scoreB: 0 });

    // A REAL question, locked but NOT YET revealed, with BOTH a real viewer pick and a real
    // opponent pick already sitting in Postgres — everything `computeNemesisFlipBlock` would
    // need is genuinely present. The publication-rule guard must still refuse to touch any of
    // it (`buildRevealPayload`'s first statement gates on `question.status`, before a single
    // `getPick` call for either side).
    const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
    const [lockedQuestion] = await db
      .insert(questions)
      .values(
        buildQuestion(market!.id as string, {
          kind: 'daily',
          questionDate: WEEK_START,
          slug: `${WEEK_START}-nemesis-flip-locked-${uuidv7()}`,
          status: 'locked', // NOT revealed
          outcome: null,
          lockAt: new Date(`${WEEK_START}T16:00:00Z`),
          settledAt: null,
          revealedAt: null,
        }),
      )
      .returning();
    await makePick(lockedQuestion!.id as string, viewer.id, { side: 'yes', result: 'pending' });
    await makePick(lockedQuestion!.id as string, opponent.id, { side: 'no', result: 'pending' });

    const question = await getQuestionById(db, lockedQuestion!.id as string);
    const market2 = await getMarketById(db, market!.id as string);

    await expect(
      buildRevealPayload({
        db,
        redis,
        question: question!,
        market: market2!,
        viewerProfileId: viewer.id,
        appUrl: 'https://receipts.example',
        at: new Date(),
      }),
    ).rejects.toThrow();
  });
});
