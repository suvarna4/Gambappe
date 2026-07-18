/**
 * WS5-T2 integration AC (§8.8, §19.3 "Bonus question selection"): `selectNemesisBonusQuestions`
 * (`apps/worker/src/lib/nemesis-bonus.ts`) against a real Postgres.
 *
 *   - category-overlap-driven selection: candidates are drawn only from categories the pair
 *     genuinely overlaps in (min(shareA, shareB) > 0), preferring higher-overlap categories, and
 *     NEVER from a category one member has zero share in — even when that category has eligible
 *     markets and the overlapping categories don't.
 *   - within an overlapping category, the earliest-closing eligible market is preferred.
 *   - 0-bonus fallback (§8.8 "skip bonus if none fit — a 0-bonus week is valid"): both the
 *     "no eligible market at all" case and the "pair shares no category" case.
 *   - eligibility filtering: only `nemesis_eligible = true`, `status = 'open'` markets whose
 *     `close_time` falls within the nemesis week are candidates.
 *
 * `nemesis:assign`'s own bonus-authoring/dedup/pairing-linkage behavior (calling this same
 * function) is covered by WS5-T1's `apps/worker/test/integration/nemesis-assign.test.ts` — this
 * suite exercises `selectNemesisBonusQuestions` directly so the category-overlap selection logic
 * (this task's AC) doesn't need a full pool/matcher/pairing setup per case.
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see every other integration
 * test's fallback default). When developing locally alongside other concurrent agents, export
 * TEST_DATABASE_URL to point at a dedicated DB instead of changing this file's fallback —
 * turbo.json's globalPassThroughEnv doesn't include TEST_DATABASE_URL, so CI relies on this
 * literal default matching the shared convention.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket } from '@receipts/db/testing';
import { SCHEDULE_TZ } from '@receipts/core';
import type pg from 'pg';
import { selectNemesisBonusQuestions } from '../../src/lib/nemesis-bonus.js';
import { addDaysToDateStr, zonedLocalTimeToUtc } from '../../src/lib/day-window.js';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const WEEK_START = '2026-07-20'; // a Monday

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE questions, markets CASCADE`);
});

// A close_time comfortably inside the nemesis week (Wednesday of WEEK_START).
function withinWeekCloseTime(dayOffset = 2): Date {
  return new Date(zonedLocalTimeToUtc(addDaysToDateStr(WEEK_START, dayOffset), 18, 0, SCHEDULE_TZ));
}

describe('selectNemesisBonusQuestions — category-overlap-driven selection (§8.8, WS5-T2 AC)', () => {
  it('selects only from the genuinely-overlapping category, never from a category one member has zero share in', async () => {
    const sportsMarket = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(),
    });
    const cultureMarket = buildMarket({
      category: 'culture',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(),
    });
    await db.insert(markets).values([sportsMarket, cultureMarket]);

    // sports: min(0.5, 0.5) = 0.5 overlap. culture: min(0, 0.5) = 0 — B likes culture, A never
    // touches it, so it is NOT an overlapping category at all.
    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 0.5, politics: 0.5 },
      sharesB: { sports: 0.5, culture: 0.5 },
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]!.marketId).toBe(sportsMarket.id);

    const bonusQuestions = await db.select().from(questions).where(sql`${questions.kind} = 'nemesis_bonus'`);
    expect(bonusQuestions).toHaveLength(1);
    expect(bonusQuestions[0]!.marketId).toBe(sportsMarket.id); // culture market never authored
  });

  it('prefers the higher-overlap category, filling remaining slots from the next-best category', async () => {
    // politics overlap = min(0.3, 0.5) = 0.3; sports overlap = min(0.6, 0.2) = 0.2 — politics
    // ranks first despite having only one eligible candidate.
    const politicsMarket = buildMarket({
      category: 'politics',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(1),
    });
    const sportsEarly = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(1), // closes first among the sports candidates
    });
    const sportsMid = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(2),
    });
    const sportsLate = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(3), // 4th-ranked candidate — must be excluded by the cap
    });
    await db.insert(markets).values([politicsMarket, sportsEarly, sportsMid, sportsLate]);

    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 0.6, politics: 0.3 },
      sharesB: { sports: 0.2, politics: 0.5 },
    });

    // MAX_BONUS_QUESTIONS is 3 (SPEC-GAP(ws5-t1): no pinned Appendix D constant): 1 from
    // politics (its only candidate) + the 2 earliest-closing sports candidates.
    expect(selected).toHaveLength(3);
    const marketIds = selected.map((q) => q.marketId);
    expect(marketIds).toContain(politicsMarket.id);
    expect(marketIds).toContain(sportsEarly.id);
    expect(marketIds).toContain(sportsMid.id);
    expect(marketIds).not.toContain(sportsLate.id); // beyond the cap
  });

  it('is a 0-bonus week when the pair shares no category at all, even though eligible markets exist', async () => {
    const sportsMarket = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(),
    });
    const politicsMarket = buildMarket({
      category: 'politics',
      status: 'open',
      nemesisEligible: true,
      closeTime: withinWeekCloseTime(),
    });
    await db.insert(markets).values([sportsMarket, politicsMarket]);

    // A only picks sports, B only picks politics — every category's min(shareA, shareB) is 0.
    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 1 },
      sharesB: { politics: 1 },
    });

    expect(selected).toEqual([]);
    const bonusQuestions = await db.select().from(questions).where(sql`${questions.kind} = 'nemesis_bonus'`);
    expect(bonusQuestions).toHaveLength(0);
  });

  it('is a 0-bonus week when the overlapping category has no eligible market at all (§8.8 fallback)', async () => {
    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 1 },
      sharesB: { sports: 1 },
    });
    expect(selected).toEqual([]);
  });
});

describe('selectNemesisBonusQuestions — eligibility filtering (§8.8 "nemesis_eligible ... resolving within the week")', () => {
  it('excludes a market not tagged nemesis_eligible', async () => {
    const ineligible = buildMarket({ category: 'sports', status: 'open', nemesisEligible: false, closeTime: withinWeekCloseTime() });
    await db.insert(markets).values(ineligible);
    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 1 },
      sharesB: { sports: 1 },
    });
    expect(selected).toEqual([]);
  });

  it('excludes a market that is not status=open', async () => {
    const closed = buildMarket({ category: 'sports', status: 'closed', nemesisEligible: true, closeTime: withinWeekCloseTime() });
    await db.insert(markets).values(closed);
    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 1 },
      sharesB: { sports: 1 },
    });
    expect(selected).toEqual([]);
  });

  it('excludes a market whose close_time falls outside the nemesis week', async () => {
    const tooEarly = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: new Date('2026-07-10T18:00:00Z'), // the prior week
    });
    const tooLate = buildMarket({
      category: 'sports',
      status: 'open',
      nemesisEligible: true,
      closeTime: new Date('2026-08-05T18:00:00Z'), // weeks later
    });
    await db.insert(markets).values([tooEarly, tooLate]);
    const selected = await selectNemesisBonusQuestions(db, {
      weekStart: WEEK_START,
      sharesA: { sports: 1 },
      sharesB: { sports: 1 },
    });
    expect(selected).toEqual([]);
  });
});
