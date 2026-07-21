/**
 * WS5-T1 integration AC (§8.4, §19.3): `nemesis:assign` against a real Postgres + pg-boss.
 *
 *   - 50(+)-profile pool: valid pairings, no repeats within a season, no blocked-pair pairings.
 *   - paused/ineligible profiles (too few graded picks, bot-flagged, nemesis-paused,
 *     paused_matchmaking/suspended/ghost) excluded from the pool.
 *   - leftover profiles (odd pool) get `matchmaking_priority=true` flagged for next run, and
 *     matched profiles have it cleared.
 *   - season auto-creation on a boundary (§8.4 step 0), rematch-first forced pairing + open/
 *     consumed-accepted request expiry, blocked rematch requests dropped.
 *   - bonus question authoring + cross-pairing dedup + 0-bonus fallback (§8.8.1).
 *   - "Meet your nemesis" outbox notifications for both sides.
 *   - `nemesis` flag gating.
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see .github/workflows/ci.yml
 * and every other integration test's fallback default). When developing locally alongside other
 * concurrent agents, export TEST_DATABASE_URL to point at a dedicated DB instead of changing this
 * file's fallback — turbo.json's globalPassThroughEnv doesn't include TEST_DATABASE_URL, so CI
 * relies on this literal default matching the shared convention.
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
  fingerprints,
  markets,
  nemesisPairings,
  notifications,
  pairingQuestions,
  picks,
  profiles,
  questions,
  ratings,
  rematchRequests,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { NEMESIS_MIN_PICKS, NEMESIS_SEASON_WEEKS } from '@receipts/core';
import { nemesisAssignHandler, runNemesisAssign } from '../../src/jobs/nemesis-assign.js';
import type { JobContext } from '../../src/context.js';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const WEEK_START = '2026-07-20'; // a Monday
const AT = new Date('2026-07-20T13:00:00Z'); // Mon 09:00 ET (EDT, UTC-4)

let pool: pg.Pool;
let db: Db;
let boss: PgBoss;

beforeAll(async () => {
  process.env.FLAG_NEMESIS = 'true';
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
    sql`TRUNCATE TABLE nemesis_pairings, pairing_questions, rematch_requests, seasons, blocks, notifications,
        fingerprints, ratings, picks, questions, markets, profiles CASCADE`,
  );
  await db.execute(sql`DELETE FROM pgboss.job WHERE name IN ('question:open','question:lock','reveal:fire')`);
});

// --- Fixtures --------------------------------------------------------------------------------

/** A handful of shared, already-graded dummy dailies every eligible profile picks on, so
 * `NEMESIS_MIN_PICKS` graded (win/loss) picks is cheap to satisfy for a large pool. */
async function makeGradedDummyQuestions(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'revealed', outcome: 'yes' });
    await db.insert(questions).values(question);
    ids.push(question.id as string);
  }
  return ids;
}

async function gradeProfileOnDummies(profileId: string, questionIds: string[]): Promise<void> {
  for (const questionId of questionIds) {
    await db.insert(picks).values(
      buildPick(questionId, profileId, {
        side: 'yes',
        yesPriceAtEntry: 0.5,
        result: 'win',
        edge: 0.5,
        gradedAt: AT,
      }),
    );
  }
}

interface EligibleFixtureOpts {
  profileOverrides?: Partial<ProfileRow>;
  chalk?: number;
  contrarian?: number;
  timing?: number;
  categoryShares?: Record<string, number>;
  rating?: number;
  rd?: number;
  gradedQuestionIds: string[];
  gradedPickCount?: number;
}

/** Inserts one eligible profile + rating + fingerprint + `gradedPickCount` graded picks. */
async function makeEligibleProfile(opts: EligibleFixtureOpts): Promise<ProfileRow> {
  const row = buildProfile({ kind: 'claimed', status: 'active', ...opts.profileOverrides });
  const [inserted] = await db.insert(profiles).values(row).returning();
  await db.insert(ratings).values({ profileId: inserted!.id, glickoRating: opts.rating ?? 1500, glickoRd: opts.rd ?? 200 });
  await db.insert(fingerprints).values({
    profileId: inserted!.id,
    chalk: opts.chalk ?? 0,
    contrarian: opts.contrarian ?? 0,
    timing: opts.timing ?? 0,
    categoryShares: opts.categoryShares ?? { sports: 1 },
    computedAt: AT,
  });
  const count = opts.gradedPickCount ?? NEMESIS_MIN_PICKS;
  await gradeProfileOnDummies(inserted!.id, opts.gradedQuestionIds.slice(0, count));
  return inserted!;
}

async function runJob(): Promise<Awaited<ReturnType<typeof runNemesisAssign>>> {
  return runNemesisAssign(db, boss, AT);
}

async function pairingsInvolving(profileId: string) {
  return db
    .select()
    .from(nemesisPairings)
    .where(sql`${nemesisPairings.profileAId} = ${profileId} OR ${nemesisPairings.profileBId} = ${profileId}`);
}

// --- Main AC: 50+ profiles ---------------------------------------------------------------------

describe('nemesis:assign — pool + matching AC (§19.3 WS5-T1)', () => {
  it('produces valid pairings for a 51-profile pool: no repeats, no blocked pairs, ineligible excluded, one leftover flagged', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);

    // 51 mutually-compatible eligible profiles (same category/rating band) — odd count
    // guarantees exactly one leftover from a fully-connected compatible pool.
    const eligible: ProfileRow[] = [];
    for (let i = 0; i < 51; i++) {
      eligible.push(
        await makeEligibleProfile({
          chalk: 0.1,
          categoryShares: { sports: 0.6, politics: 0.4 },
          rating: 1500,
          rd: 200,
          gradedQuestionIds,
        }),
      );
    }

    // Ineligible profiles that must NEVER appear in a pairing:
    const tooFewPicks = await makeEligibleProfile({ gradedQuestionIds, gradedPickCount: NEMESIS_MIN_PICKS - 1 });
    const botFlagged = await makeEligibleProfile({ profileOverrides: { botScore: 0.9 }, gradedQuestionIds });
    const nemesisPaused = await makeEligibleProfile({
      profileOverrides: { settings: { nemesis_paused: true } },
      gradedQuestionIds,
    });
    const pausedMatchmaking = await makeEligibleProfile({
      profileOverrides: { status: 'paused_matchmaking' },
      gradedQuestionIds,
    });
    const suspended = await makeEligibleProfile({ profileOverrides: { status: 'suspended' }, gradedQuestionIds });
    const ghost = buildProfile({ kind: 'ghost', status: 'active' });
    await db.insert(profiles).values(ghost);

    // A blocked pair, both otherwise eligible members of the 51 — must never be paired together.
    const [blockerA, blockedB] = [eligible[0]!, eligible[1]!];
    await db.insert(blocks).values({ blockerProfileId: blockerA.id, blockedProfileId: blockedB.id });

    const report = await runJob();

    expect(report.poolSize).toBe(51);
    expect(report.seasonCreated).toBe(true);
    expect(report.weekStart).toBe(WEEK_START);
    expect(report.leftovers).toBe(1);
    expect(report.pairingsCreated).toBe(25); // floor(51/2)

    const allPairings = await db.select().from(nemesisPairings);
    expect(allPairings).toHaveLength(25);

    // No repeats: every profile id appears in at most one pairing.
    const seen = new Set<string>();
    for (const p of allPairings) {
      expect(seen.has(p.profileAId)).toBe(false);
      expect(seen.has(p.profileBId)).toBe(false);
      seen.add(p.profileAId);
      seen.add(p.profileBId);
      expect(p.profileAId < p.profileBId).toBe(true); // canonical order (§5.5)
      expect(p.status).toBe('active');
      expect(p.seasonId).toBeTruthy();
      expect(p.weekStart).toBe(WEEK_START);
    }

    // No blocked pair ever paired together.
    const blockedTogether = allPairings.some(
      (p) =>
        (p.profileAId === blockerA.id && p.profileBId === blockedB.id) ||
        (p.profileAId === blockedB.id && p.profileBId === blockerA.id),
    );
    expect(blockedTogether).toBe(false);

    // Ineligible profiles never appear.
    const ineligibleIds = [tooFewPicks.id, botFlagged.id, nemesisPaused.id, pausedMatchmaking.id, suspended.id, ghost.id as string];
    for (const id of ineligibleIds) {
      expect(seen.has(id)).toBe(false);
    }

    // Exactly one of the 51 eligible profiles is the leftover (matched 50, 1 left over).
    const matchedEligible = eligible.filter((p) => seen.has(p.id));
    const leftoverEligible = eligible.filter((p) => !seen.has(p.id));
    expect(matchedEligible).toHaveLength(50);
    expect(leftoverEligible).toHaveLength(1);

    const [leftoverRow] = await db.select().from(profiles).where(sql`${profiles.id} = ${leftoverEligible[0]!.id}`);
    expect(leftoverRow!.matchmakingPriority).toBe(true);

    const [matchedRow] = await db.select().from(profiles).where(sql`${profiles.id} = ${matchedEligible[0]!.id}`);
    expect(matchedRow!.matchmakingPriority).toBe(false);

    // A season was auto-created covering this week (§8.4 step 0).
    const [seasonRow] = await db.select().from(seasons).where(sql`${seasons.id} = ${allPairings[0]!.seasonId}`);
    expect(seasonRow!.startsOn).toBe(WEEK_START);
    const expectedEnds = new Date(`${WEEK_START}T00:00:00Z`);
    expectedEnds.setUTCDate(expectedEnds.getUTCDate() + NEMESIS_SEASON_WEEKS * 7 - 1);
    expect(seasonRow!.endsOn).toBe(expectedEnds.toISOString().slice(0, 10));

    // Outbox notifications: both channels, both sides, for every pairing.
    const notifRows = await db.select().from(notifications).where(sql`${notifications.kind} = 'nemesis_assigned'`);
    expect(notifRows).toHaveLength(25 * 2 * 2); // 25 pairings × 2 profiles × 2 channels
    for (const row of notifRows) {
      expect(row.status).toBe('queued');
      expect(['email', 'push']).toContain(row.channel);
      expect((row.payload as { line: string }).line.length).toBeGreaterThan(0);
    }
  });

  it('does not repeat a pairing already made earlier this season', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    const a = await makeEligibleProfile({ chalk: 0.1, categoryShares: { sports: 1 }, gradedQuestionIds });
    const b = await makeEligibleProfile({ chalk: 0.1, categoryShares: { sports: 1 }, gradedQuestionIds });

    const first = await runJob();
    expect(first.pairingsCreated).toBe(1);
    const [firstPairing] = await db.select().from(nemesisPairings);
    expect([firstPairing!.profileAId, firstPairing!.profileBId].sort()).toEqual([a.id, b.id].sort());

    // Second run, same week: both profiles already hold an `active` pairing for this week, so the
    // WS20-T3 (D-J5) double-assignment guard in `listNemesisEligiblePool` now excludes them from
    // the pool outright — they are not even candidates, hence 0 new pairings AND 0 leftovers (a
    // leftover is an eligible-but-unmatched profile; these two are ineligible this week because
    // they already have a pairing). The no-duplicate guarantee still holds (still exactly 1 row),
    // now enforced one layer earlier than the matcher's "not previously paired this season" check
    // and the DB's partial-unique index (both remain as defense in depth).
    const second = await runJob();
    expect(second.pairingsCreated).toBe(0);
    expect(second.leftovers).toBe(0);
    const allPairingsAfter = await db.select().from(nemesisPairings);
    expect(allPairingsAfter).toHaveLength(1);
  });
});

// --- Season boundary + rematch handling (§8.4 step 0) -------------------------------------------

describe('nemesis:assign — season + rematch (§8.4 step 0)', () => {
  it('reuses an existing season covering the week (no duplicate season created)', async () => {
    const endsOn = new Date(`${WEEK_START}T00:00:00Z`);
    endsOn.setUTCDate(endsOn.getUTCDate() + NEMESIS_SEASON_WEEKS * 7 - 1);
    const existingSeasonId = uuidv7();
    await db.insert(seasons).values({
      id: existingSeasonId,
      kind: 'nemesis',
      startsOn: WEEK_START,
      endsOn: endsOn.toISOString().slice(0, 10),
      name: 'Existing season',
    });

    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    await makeEligibleProfile({ gradedQuestionIds });
    await makeEligibleProfile({ gradedQuestionIds });

    const report = await runJob();
    expect(report.seasonCreated).toBe(false);
    expect(report.seasonId).toBe(existingSeasonId);

    const allSeasons = await db.select().from(seasons);
    expect(allSeasons).toHaveLength(1);
  });

  it('mutually-accepted rematch requests become forced pairings marked is_rematch, and the request is consumed (expired)', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    // Deliberately style-incompatible + far-apart ratings so organic matching would NEVER pair
    // these two on its own — only the forced rematch path can produce this pairing.
    const a = await makeEligibleProfile({ chalk: 0.9, categoryShares: { sports: 1 }, rating: 1500, gradedQuestionIds });
    const b = await makeEligibleProfile({ chalk: -0.9, categoryShares: { science: 1 }, rating: 2200, gradedQuestionIds });

    const existingSeasonId = uuidv7();
    const endsOn = new Date(`${WEEK_START}T00:00:00Z`);
    endsOn.setUTCDate(endsOn.getUTCDate() + NEMESIS_SEASON_WEEKS * 7 - 1);
    await db.insert(seasons).values({
      id: existingSeasonId,
      kind: 'nemesis',
      startsOn: WEEK_START,
      endsOn: endsOn.toISOString().slice(0, 10),
      name: 'S',
    });

    const requestId = uuidv7();
    await db.insert(rematchRequests).values({
      id: requestId,
      requesterProfileId: a.id,
      targetProfileId: b.id,
      seasonId: existingSeasonId,
      status: 'accepted',
    });

    const report = await runJob();
    expect(report.forcedPairingsCreated).toBe(1);

    const pairs = await pairingsInvolving(a.id);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.isRematch).toBe(true);
    expect([pairs[0]!.profileAId, pairs[0]!.profileBId].sort()).toEqual([a.id, b.id].sort());

    const [reqRow] = await db.select().from(rematchRequests).where(sql`${rematchRequests.id} = ${requestId}`);
    expect(reqRow!.status).toBe('expired');
  });

  it('expires an open rematch request not accepted by this run', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    const a = await makeEligibleProfile({ gradedQuestionIds });
    const b = await makeEligibleProfile({ gradedQuestionIds });
    const existingSeasonId = uuidv7();
    const endsOn = new Date(`${WEEK_START}T00:00:00Z`);
    endsOn.setUTCDate(endsOn.getUTCDate() + NEMESIS_SEASON_WEEKS * 7 - 1);
    await db.insert(seasons).values({ id: existingSeasonId, kind: 'nemesis', startsOn: WEEK_START, endsOn: endsOn.toISOString().slice(0, 10), name: 'S' });

    const requestId = uuidv7();
    await db.insert(rematchRequests).values({ id: requestId, requesterProfileId: a.id, targetProfileId: b.id, seasonId: existingSeasonId, status: 'open' });

    await runJob();
    const [reqRow] = await db.select().from(rematchRequests).where(sql`${rematchRequests.id} = ${requestId}`);
    expect(reqRow!.status).toBe('expired');
  });

  it('does not force-pair a mutually-accepted rematch when the pair is blocked', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    const a = await makeEligibleProfile({ gradedQuestionIds });
    const b = await makeEligibleProfile({ gradedQuestionIds });
    await db.insert(blocks).values({ blockerProfileId: a.id, blockedProfileId: b.id });

    const existingSeasonId = uuidv7();
    const endsOn = new Date(`${WEEK_START}T00:00:00Z`);
    endsOn.setUTCDate(endsOn.getUTCDate() + NEMESIS_SEASON_WEEKS * 7 - 1);
    await db.insert(seasons).values({ id: existingSeasonId, kind: 'nemesis', startsOn: WEEK_START, endsOn: endsOn.toISOString().slice(0, 10), name: 'S' });

    const requestId = uuidv7();
    await db.insert(rematchRequests).values({ id: requestId, requesterProfileId: a.id, targetProfileId: b.id, seasonId: existingSeasonId, status: 'accepted' });

    const report = await runJob();
    expect(report.forcedPairingsCreated).toBe(0);
    expect(await pairingsInvolving(a.id)).toHaveLength(0);
  });
});

// --- Bonus questions (§8.8.1) -------------------------------------------------------------------

describe('nemesis:assign — bonus question selection (§8.8.1)', () => {
  it('authors a nemesis_bonus question for an eligible market within the week, and links it via pairing_questions', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    const a = await makeEligibleProfile({ categoryShares: { sports: 1 }, gradedQuestionIds });
    await makeEligibleProfile({ categoryShares: { sports: 1 }, gradedQuestionIds }); // pairs with `a`

    const bonusMarket = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: new Date('2026-07-24T18:00:00Z'), // Friday of the nemesis week
    });
    await db.insert(markets).values(bonusMarket);

    await runJob();

    const pairs = await pairingsInvolving(a.id);
    expect(pairs).toHaveLength(1);
    const links = await db.select().from(pairingQuestions).where(sql`${pairingQuestions.pairingId} = ${pairs[0]!.id}`);
    expect(links).toHaveLength(1);

    const [bonusQuestion] = await db.select().from(questions).where(sql`${questions.id} = ${links[0]!.questionId}`);
    expect(bonusQuestion!.kind).toBe('nemesis_bonus');
    expect(bonusQuestion!.marketId).toBe(bonusMarket.id);
    expect(bonusQuestion!.status).toBe('open');
    expect(bonusQuestion!.questionDate).toBeNull();
    expect(bonusQuestion!.lockAt.getTime()).toBe(bonusQuestion!.revealAt.getTime()); // §8.8.1: no held reveal
    expect(bonusQuestion!.lockAt.getTime()).toBeLessThanOrEqual(bonusMarket.closeTime!.getTime());
  });

  it('reuses (dedups) the same bonus question across two different pairings sharing the only eligible market', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    const [a, b, c, d] = await Promise.all([
      makeEligibleProfile({ categoryShares: { sports: 1 }, rating: 1500, gradedQuestionIds }),
      makeEligibleProfile({ categoryShares: { sports: 1 }, rating: 1500, gradedQuestionIds }),
      makeEligibleProfile({ categoryShares: { sports: 1 }, rating: 1900, gradedQuestionIds }),
      makeEligibleProfile({ categoryShares: { sports: 1 }, rating: 1900, gradedQuestionIds }),
    ]);
    // Two rating bands far enough apart that (a,b) and (c,d) pair off, not cross-band.
    const bonusMarket = buildMarket({ category: 'sports', status: 'open', nemesisEligible: true, closeTime: new Date('2026-07-24T18:00:00Z') });
    await db.insert(markets).values(bonusMarket);

    await runJob();

    const allPairings = await db.select().from(nemesisPairings);
    expect(allPairings).toHaveLength(2);
    const allLinks = await db.select().from(pairingQuestions);
    expect(allLinks).toHaveLength(2); // one link per pairing...
    const distinctQuestionIds = new Set(allLinks.map((l) => l.questionId));
    expect(distinctQuestionIds.size).toBe(1); // ...but both link to the SAME reused question row.

    const bonusQuestions = await db.select().from(questions).where(sql`${questions.kind} = 'nemesis_bonus'`);
    expect(bonusQuestions).toHaveLength(1);
    void a;
    void b;
    void c;
    void d;
  });

  it('0-bonus is a valid outcome when no nemesis_eligible market fits the week', async () => {
    const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
    await makeEligibleProfile({ categoryShares: { sports: 1 }, gradedQuestionIds });
    await makeEligibleProfile({ categoryShares: { sports: 1 }, gradedQuestionIds });

    const report = await runJob();
    expect(report.pairingsCreated).toBe(1);
    expect(report.bonusQuestionsCreated).toBe(0);

    const links = await db.select().from(pairingQuestions);
    expect(links).toHaveLength(0);
  });
});

// --- Flag gating -----------------------------------------------------------------------------

describe('nemesis:assign — flag gating', () => {
  it('is a no-op when the nemesis flag is disabled', async () => {
    process.env.FLAG_NEMESIS = 'false';
    try {
      const gradedQuestionIds = await makeGradedDummyQuestions(NEMESIS_MIN_PICKS);
      await makeEligibleProfile({ gradedQuestionIds });
      await makeEligibleProfile({ gradedQuestionIds });

      const ctx: JobContext = { db, pool, boss, redis: undefined as unknown as JobContext['redis'] };
      await nemesisAssignHandler(ctx, undefined);

      const allPairings = await db.select().from(nemesisPairings);
      expect(allPairings).toHaveLength(0);
    } finally {
      process.env.FLAG_NEMESIS = 'true';
    }
  });
});
