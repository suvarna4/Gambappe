/**
 * WS6-T3 integration: `duo:window-roll`'s §8.10 ladder addition against a real Postgres —
 *   - season bootstrap: the first-ever run creates the first `duo` season with zero movements
 *     (nothing to conclude yet; every duo is already tier 1 by schema default).
 *   - season-boundary promotion/relegation: once a prior `duo` season's `ends_on` is behind the
 *     firing window's start, its standings (wins from `duo_matches` completed within that
 *     season's date range, tie-broken by rating) get promoted/relegated per §8.10's 20/20% split,
 *     the next season is created, and a season still covering the window is a pure no-op.
 *   - odd-duo sit-out priority round-trip (§8.10): the duo left out of an odd-sized tier gets
 *     `matchmaking_priority` flagged, and the NEXT window-roll honors it — a different duo sits
 *     out rather than the same one twice in a row.
 *
 * Connects via TEST_DATABASE_URL (falls back to receipts_test — matches every other integration
 * test's convention exactly, `duo-window-roll.test.ts` included) and reuses that same file's
 * fixed Tue/Fri roll instants so the two files' window math lines up.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import { addDaysToDateString } from '@receipts/core';
import { connect, duoMatches, duos, markets, profiles, questions, seasons, type Db } from '@receipts/db';
import { buildDuo, buildMarket, buildProfile, buildQuestion, buildSeason } from '@receipts/db/testing';
import { runDuoWindowRoll } from '../../src/jobs/duo-window-roll.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

// Same fixed instants as duo-window-roll.test.ts: 09:00 ET on a Tuesday / Friday in July (EDT).
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
    sql`TRUNCATE TABLE duo_match_questions, duo_matches, duos, picks, questions, markets, profiles, seasons RESTART IDENTITY CASCADE`,
  );
  await db.execute(sql`DELETE FROM pgboss.job`);
});

async function makeDuo(overrides: Partial<typeof duos.$inferInsert> = {}): Promise<string> {
  const [profileX, profileY] = await Promise.all([
    db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active' })).returning(),
    db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active' })).returning(),
  ]);
  const x = profileX[0]!.id;
  const y = profileY[0]!.id;
  const [a, b] = x < y ? [x, y] : [y, x];
  const [inserted] = await db.insert(duos).values(buildDuo(a, b, overrides)).returning();
  return inserted!.id;
}

/** A `completed` duo_matches row purely to seed a win count for `winnerDuoId` — the other duo
 * in the pairing is irrelevant to the ladder math, just needs a valid FK. */
async function makeCompletedMatch(winnerDuoId: string, loserDuoId: string, windowStart: string): Promise<void> {
  await db.insert(duoMatches).values({
    id: uuidv7(),
    duoAId: winnerDuoId < loserDuoId ? winnerDuoId : loserDuoId,
    duoBId: winnerDuoId < loserDuoId ? loserDuoId : winnerDuoId,
    windowStart,
    windowEnd: addDaysToDateString(windowStart, 2),
    status: 'completed',
    winnerDuoId,
  });
}

describe('duo:window-roll — §8.10 season bootstrap', () => {
  it('creates the first duo season with zero ladder movements when none existed before', async () => {
    const a = await makeDuo({ tier: 1 });
    const b = await makeDuo({ tier: 1 });

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.seasonRolled).toBe(true);
    expect(report!.ladderPromoted).toBe(0);
    expect(report!.ladderRelegated).toBe(0);

    const seasonRows = await db.select().from(seasons).where(eq(seasons.kind, 'duo'));
    expect(seasonRows).toHaveLength(1);
    expect(seasonRows[0]!.startsOn).toBe('2026-07-21');
    expect(seasonRows[0]!.endsOn).toBe('2026-08-17'); // DUO_SEASON_WEEKS=4 -> +27 days
    expect(report!.seasonId).toBe(seasonRows[0]!.id);

    // Untouched — both duos entered (and stay) at tier 1, the schema default.
    const [duoA] = await db.select().from(duos).where(eq(duos.id, a));
    const [duoB] = await db.select().from(duos).where(eq(duos.id, b));
    expect(duoA!.tier).toBe(1);
    expect(duoB!.tier).toBe(1);
  });
});

describe('duo:window-roll — §8.10 season boundary promotion/relegation', () => {
  it('promotes the top 20% and relegates the bottom 20% of a tier at season end, then starts the next season', async () => {
    // A prior duo season that just ended (ends_on is BEFORE this Tuesday's window_start).
    await db.insert(seasons).values(buildSeason({ kind: 'duo', startsOn: '2026-06-23', endsOn: '2026-07-20' }));

    // 5 duos, one tier — a clean 20% boundary (1 promoted, 1 relegated).
    const duoA = await makeDuo({ tier: 2, glickoRating: 1900 }); // 3 wins -> top -> promoted
    const duoB = await makeDuo({ tier: 2, glickoRating: 1700 }); // 1 win
    const duoC = await makeDuo({ tier: 2, glickoRating: 1600 }); // 0 wins, rank 3 by rating tie-break
    const duoD = await makeDuo({ tier: 2, glickoRating: 1500 }); // 0 wins, rank 4
    const duoE = await makeDuo({ tier: 2, glickoRating: 1400 }); // 0 wins, rank 5 -> bottom -> relegated

    // Win counts, all within the ending season's [2026-06-23, 2026-07-20] window range.
    await makeCompletedMatch(duoA, duoB, '2026-07-14');
    await makeCompletedMatch(duoA, duoC, '2026-07-14');
    await makeCompletedMatch(duoA, duoD, '2026-07-17');
    await makeCompletedMatch(duoB, duoE, '2026-07-17');
    // A completed match OUTSIDE the season range must not count toward this season's standings.
    await makeCompletedMatch(duoE, duoD, '2026-05-01');

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.seasonRolled).toBe(true);
    expect(report!.ladderPromoted).toBe(1);
    expect(report!.ladderRelegated).toBe(1);

    const rows = await db.select().from(duos);
    const tierOf = (id: string): number => rows.find((r) => r.id === id)!.tier;
    expect(tierOf(duoA)).toBe(3); // promoted
    expect(tierOf(duoE)).toBe(1); // relegated
    expect(tierOf(duoB)).toBe(2); // unchanged
    expect(tierOf(duoC)).toBe(2); // unchanged
    expect(tierOf(duoD)).toBe(2); // unchanged

    // The next season was created, anchored at this window's start.
    const duoSeasons = await db.select().from(seasons).where(eq(seasons.kind, 'duo'));
    expect(duoSeasons).toHaveLength(2);
    const newSeason = duoSeasons.find((s) => s.startsOn === '2026-07-21');
    expect(newSeason).toBeDefined();
    expect(newSeason!.endsOn).toBe('2026-08-17');
  });

  it('is a no-op when a duo season already covers the firing window (no re-scoring, no movement)', async () => {
    // A season that already covers BOTH Tuesday's and Friday's window starts.
    await db.insert(seasons).values(buildSeason({ kind: 'duo', startsOn: '2026-07-21', endsOn: '2026-08-17' }));
    const a = await makeDuo({ tier: 2, glickoRating: 1900 });
    const b = await makeDuo({ tier: 2, glickoRating: 1000 });
    // Even with a lopsided win count between the only two duos in the tier, no movement should
    // happen — the season hasn't ended yet, so §8.10 doesn't fire.
    await makeCompletedMatch(a, b, '2026-07-14');

    const report = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);

    expect(report!.seasonRolled).toBe(false);
    expect(report!.ladderPromoted).toBe(0);
    expect(report!.ladderRelegated).toBe(0);
    const seasonRows = await db.select().from(seasons).where(eq(seasons.kind, 'duo'));
    expect(seasonRows).toHaveLength(1); // no new season created

    const [duoA] = await db.select().from(duos).where(eq(duos.id, a));
    expect(duoA!.tier).toBe(2); // untouched
  });
});

describe('duo:window-roll — §8.10 odd-duo sit-out priority (E2E round-trip)', () => {
  it('a duo that sat out one window is not the one to sit out the next window when an alternative exists', async () => {
    const a = await makeDuo({ tier: 1, glickoRating: 1000 });
    const b = await makeDuo({ tier: 1, glickoRating: 1050 });
    const c = await makeDuo({ tier: 1, glickoRating: 1900 }); // farthest -> sits out run 1

    // The Tue-Thu window's 3 dailies — needed so the a+b match run 1 creates has a non-empty
    // "own questions" set for run 2's straggler backstop to force-complete (an empty-questions
    // match is deliberately never force-completed, per duo-window-roll.test.ts's own AC). Left
    // ungraded on purpose — the backstop's `force: true` only requires the question SET to be
    // non-empty, not settled (§8.9's exclusion handling degrades gracefully to a 0-0 draw).
    for (const questionDate of ['2026-07-21', '2026-07-22', '2026-07-23']) {
      const [market] = await db.insert(markets).values(buildMarket({ status: 'open' })).returning();
      await db.insert(questions).values(buildQuestion(market!.id, { questionDate, status: 'open' }));
    }

    const firstReport = await runDuoWindowRoll(db, boss, TUESDAY_ROLL);
    expect(firstReport!.oddOneOut).toEqual([c]);

    const [cAfterRun1] = await db.select().from(duos).where(eq(duos.id, c));
    expect(cAfterRun1!.matchmakingPriority).toBe(true);
    const [aAfterRun1] = await db.select().from(duos).where(eq(duos.id, a));
    expect(aAfterRun1!.matchmakingPriority).toBe(false);

    // Friday: the Tue-Thu match from run 1 (a+b) is now overdue and gets straggler-backstop
    // force-completed, freeing a and b to be re-paired alongside c, which never got matched.
    const secondReport = await runDuoWindowRoll(db, boss, FRIDAY_ROLL);
    expect(secondReport!.backstopCompleted).toBe(1);

    // Without priority, 'b' (highest-rated of the two non-priority duos, a and b) sits out this
    // time instead of c sitting out twice in a row.
    expect(secondReport!.oddOneOut).toEqual([b]);
    expect(secondReport!.matchesCreated).toBe(1);

    const [bAfterRun2] = await db.select().from(duos).where(eq(duos.id, b));
    expect(bAfterRun2!.matchmakingPriority).toBe(true);
    const [cAfterRun2] = await db.select().from(duos).where(eq(duos.id, c));
    expect(cAfterRun2!.matchmakingPriority).toBe(false); // cleared — c was considered and got matched this run

    const freshMatch = await db
      .select()
      .from(duoMatches)
      .where(eq(duoMatches.windowStart, '2026-07-24'));
    expect(freshMatch).toHaveLength(1);
    expect([freshMatch[0]!.duoAId, freshMatch[0]!.duoBId].sort()).toEqual([a, c].sort());
  });
});
