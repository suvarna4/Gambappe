/**
 * SW10-T3(b) (wiring-gaps doc §4 SW10-T3): `viewer.duo_tandem` emission — the REAL
 * `buildRevealPayload` against really-seeded Postgres, matching `nemesis-flip-payload.test.ts`'s
 * (SW10-T1) own binding rule: real `duos`/`questions`/`picks` rows, no hand-built payload shapes.
 *
 * Covers:
 *  - the mechanical emission condition (no active duo -> null; duo but partner hasn't picked ->
 *    null; both picked -> populated; viewer no-pick/void -> the whole `viewer` block is absent,
 *    the "impossible state" case);
 *  - the `duo_queue` flag gate;
 *  - the "structurally unreachable pre-reveal" guarantee: a `locked` (not yet `revealed`)
 *    question with a REAL partner pick already sitting in Postgres still throws before any
 *    viewer content (duo or otherwise) is assembled — `buildRevealPayload`'s very first
 *    statement gates on `question.status`, before touching a single pick row.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import {
  connect,
  duos,
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
import {
  buildDuo,
  buildMarket,
  buildNemesisPairing,
  buildPick,
  buildProfile,
  buildQuestion,
  buildSeason,
  computeEdge,
} from '@receipts/db/testing';
import { buildRevealPayload } from '@/lib/reveal-payload';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

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
    sql`TRUNCATE TABLE duo_match_questions, duo_matches, duos, pairing_questions, nemesis_pairings, seasons, picks, questions, markets, profiles RESTART IDENTITY CASCADE`,
  );
});

const ORIGINAL_FLAG_DUO_QUEUE = process.env.FLAG_DUO_QUEUE;
const ORIGINAL_FLAG_NEMESIS = process.env.FLAG_NEMESIS;

beforeEach(() => {
  process.env.FLAG_DUO_QUEUE = 'true';
});

afterEach(() => {
  process.env.FLAG_DUO_QUEUE = ORIGINAL_FLAG_DUO_QUEUE;
  process.env.FLAG_NEMESIS = ORIGINAL_FLAG_NEMESIS;
});

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const [row] = await db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active', ...overrides })).returning();
  return row!;
}

async function makeActiveDuo(memberAId: string, memberBId: string): Promise<string> {
  const [a, b] = memberAId < memberBId ? [memberAId, memberBId] : [memberBId, memberAId];
  const [inserted] = await db.insert(duos).values(buildDuo(a, b, { status: 'active' })).returning();
  return inserted!.id;
}

/** Real nemesis-pairing machinery (mirrors `nemesis-flip-payload.test.ts`'s own helpers) — used
 * only by the "both blocks populate together" test below, which needs a genuine second
 * relationship (a nemesis pairing) alongside the duo, both covering the SAME question. */
async function makeSeasonRow(weekStart: string): Promise<string> {
  const [row] = await db.insert(seasons).values(buildSeason({ startsOn: weekStart, endsOn: '2026-09-28' })).returning();
  return row!.id;
}

async function makeNemesisPairing(seasonId: string, weekStart: string, profileAId: string, profileBId: string): Promise<void> {
  await db
    .insert(nemesisPairings)
    .values(buildNemesisPairing(seasonId, profileAId, profileBId, { weekStart, status: 'active', scoreA: 0, scoreB: 0 }))
    .returning();
}

/** A real, revealed `daily` question. */
async function makeRevealedDailyQuestion(overrides: Partial<typeof questions.$inferInsert> = {}): Promise<string> {
  const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
  const base = buildQuestion(market!.id as string, { kind: 'daily' });
  const revealedAt = new Date(`${base.questionDate}T20:00:00Z`);
  const [inserted] = await db
    .insert(questions)
    .values({
      ...base,
      status: 'revealed',
      outcome: 'yes',
      settledAt: revealedAt,
      revealedAt,
      crowdYesAtLock: 6,
      crowdNoAtLock: 4,
      ...overrides,
    })
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

describe('buildRevealPayload — duo_tandem mechanical condition (SW10-T3)', () => {
  it('is null when the viewer has no active duo', async () => {
    const viewer = await makeClaimedProfile();
    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer).toBeDefined();
    expect(payload.viewer!.duo_tandem).toBeNull();
  });

  it("is null when there's an active duo but the partner has not picked this question", async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    // No pick from `partner` on this question.

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer!.duo_tandem).toBeNull();
  });

  it('is populated when both the viewer and the partner have picked', async () => {
    const [viewer, partner] = await Promise.all([
      makeClaimedProfile({ handle: 'Viewer H.' }),
      makeClaimedProfile({ handle: 'Partner H.' }),
    ]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion({ yesLabel: 'Yes it will', noLabel: 'No it will not' });
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, partner.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    const tandem = payload.viewer!.duo_tandem;
    expect(tandem).not.toBeNull();
    expect(tandem!.partner_handle).toBe('Partner H.');
    expect(tandem!.partner_side).toBe('no');
    expect(tandem!.partner_side_label).toBe('No it will not');
  });

  it('is populated (matched) when the viewer and partner picked the same side', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, partner.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer!.duo_tandem!.partner_side).toBe('yes');
    expect(payload.viewer!.pick.side).toBe('yes');
  });

  it('viewer no-pick: the whole `viewer` block is absent, hence no tandem block (impossible-state case)', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, partner.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });
    // Viewer never picked at all.

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer).toBeUndefined();
  });

  it('viewer void pick: the whole `viewer` block is absent, hence no tandem block (impossible-state case)', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, viewer.id, { side: 'yes', result: 'void', edge: 0, yesPriceAtEntry: 0.6 });
    await makePick(qId, partner.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer).toBeUndefined();
  });

  it('is null when the `duo_queue` flag is off, even with an active duo and a mutual pick', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, partner.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    process.env.FLAG_DUO_QUEUE = 'false';
    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer!.duo_tandem).toBeNull();
    // Byte-identical-otherwise: the rest of the viewer block is completely unaffected.
    expect(payload.viewer!.result).toBe('win');
  });

  it('is independent of nemesis_flip when only a duo exists: duo_tandem populates, nemesis_flip stays null', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    const qId = await makeRevealedDailyQuestion();
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, partner.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    const payload = await getPayloadFor(qId, viewer.id);
    expect(payload.viewer!.duo_tandem).not.toBeNull();
    expect(payload.viewer!.nemesis_flip).toBeNull(); // no nemesis pairing seeded — independently null
  });

  it('BOTH blocks populate together for the same viewer on the same question (fable review of PR #90 — the one-sided version above only proved nemesis_flip stays null when absent, not that both fire together)', async () => {
    const WEEK_START = '2026-07-13'; // a Monday
    const [viewer, duoPartner, nemesisOpponent] = await Promise.all([
      makeClaimedProfile({ handle: 'Viewer H.' }),
      makeClaimedProfile({ handle: 'Duo Partner H.' }),
      makeClaimedProfile({ handle: 'Nemesis Opponent H.' }),
    ]);
    await makeActiveDuo(viewer.id, duoPartner.id);
    const seasonId = await makeSeasonRow(WEEK_START);
    await makeNemesisPairing(seasonId, WEEK_START, viewer.id, nemesisOpponent.id);

    // One real daily question, dated inside the nemesis pairing's week, that all THREE profiles
    // pick — proving the viewer can be in both relationships at once and have both blocks
    // populate from the SAME reveal, not two separately-mocked scenarios.
    const qId = await makeRevealedDailyQuestion({ questionDate: '2026-07-14' });
    await makePick(qId, viewer.id, { side: 'yes', result: 'win', edge: computeEdge('yes', 0.6, true), yesPriceAtEntry: 0.6 });
    await makePick(qId, duoPartner.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });
    await makePick(qId, nemesisOpponent.id, { side: 'no', result: 'loss', edge: computeEdge('no', 0.6, false), yesPriceAtEntry: 0.6 });

    process.env.FLAG_NEMESIS = 'true';
    const payload = await getPayloadFor(qId, viewer.id);

    expect(payload.viewer!.duo_tandem).not.toBeNull();
    expect(payload.viewer!.duo_tandem!.partner_handle).toBe('Duo Partner H.');
    expect(payload.viewer!.nemesis_flip).not.toBeNull();
    expect(payload.viewer!.nemesis_flip!.opponent_handle).toBe('Nemesis Opponent H.');
  });
});

describe('buildRevealPayload — duo_tandem is structurally unreachable pre-reveal (SW10-T3)', () => {
  it('throws before assembling any viewer content for a `locked` question, even with a REAL partner pick already in Postgres', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeActiveDuo(viewer.id, partner.id);

    // A REAL question, locked but NOT YET revealed, with BOTH a real viewer pick and a real
    // partner pick already sitting in Postgres — everything `computeDuoTandemBlock` would need
    // is genuinely present. The publication-rule guard must still refuse to touch any of it
    // (`buildRevealPayload`'s first statement gates on `question.status`, before a single
    // `getPick` call for either side).
    const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
    const [lockedQuestion] = await db
      .insert(questions)
      .values(
        buildQuestion(market!.id as string, {
          kind: 'daily',
          status: 'locked', // NOT revealed
          outcome: null,
          settledAt: null,
          revealedAt: null,
        }),
      )
      .returning();
    await makePick(lockedQuestion!.id as string, viewer.id, { side: 'yes', result: 'pending' });
    await makePick(lockedQuestion!.id as string, partner.id, { side: 'no', result: 'pending' });

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
