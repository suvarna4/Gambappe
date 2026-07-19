/**
 * WS7-T4 integration: the public-profile repository helpers (§9.2 `GET /profiles/:slug(/picks)`)
 * against a real Postgres — `listPublicPicksForProfile` cursor pagination and `is_public`
 * filtering, `countCalledItPicks`'s publication-rule respect (§6.5: a longshot win on a
 * graded-but-unrevealed daily must NOT count until revealed), and the nemesis lifetime summary.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { insertMarket, insertQuestion } from '../../src/repositories/questions.js';
import { insertPick } from '../../src/repositories/picks.js';
import { insertProfile } from '../../src/repositories/profiles.js';
import {
  getNemesisSummaryForProfile,
  countCalledItPicks,
  listPublicPicksForProfile,
} from '../../src/repositories/profile-page.js';
import { nemesisPairings, seasons } from '../../src/schema/index.js';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '../../src/testing/index.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE picks, questions, markets, profiles, nemesis_pairings, seasons, wallet_links RESTART IDENTITY CASCADE`,
  );
});

describe('listPublicPicksForProfile (§9.2)', () => {
  it("returns only that profile's public picks, newest first, and paginates by cursor", async () => {
    const profile = await insertProfile(db, buildProfile());
    const other = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const q1 = await insertQuestion(db, buildQuestion(market.id, { questionDate: '2026-01-01' }));
    const q2 = await insertQuestion(db, buildQuestion(market.id, { questionDate: '2026-01-02' }));
    const q3 = await insertQuestion(db, buildQuestion(market.id, { questionDate: '2026-01-03' }));

    const t0 = new Date('2026-01-01T12:00:00Z').getTime();
    await insertPick(db, buildPick(q1.id, profile.id, { pickedAt: new Date(t0) }));
    await insertPick(db, buildPick(q2.id, profile.id, { pickedAt: new Date(t0 + 60_000) }));
    await insertPick(db, buildPick(q3.id, profile.id, { pickedAt: new Date(t0 + 120_000) }));
    // Another profile's pick must never leak in.
    await insertPick(db, buildPick(q1.id, other.id, { pickedAt: new Date(t0 + 180_000) }));
    // A private (deleted-account) pick must never leak in.
    const q4 = await insertQuestion(db, buildQuestion(market.id, { questionDate: '2026-01-04' }));
    await insertPick(
      db,
      buildPick(q4.id, profile.id, { pickedAt: new Date(t0 + 240_000), isPublic: false }),
    );

    const page1 = await listPublicPicksForProfile(db, profile.id, null, 2);
    expect(page1.map((r) => r.question.id)).toEqual([q3.id, q2.id]);

    const cursor = { pickedAt: page1[1]!.pick.pickedAt.toISOString(), id: page1[1]!.pick.id };
    const page2 = await listPublicPicksForProfile(db, profile.id, cursor, 2);
    expect(page2.map((r) => r.question.id)).toEqual([q1.id]);
  });
});

describe('countCalledItPicks (§6.7, §6.5 publication rule)', () => {
  const threshold = 0.2;

  it('counts a public win at/under the threshold on a REVEALED daily', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { status: 'revealed', revealedAt: new Date() }),
    );
    await insertPick(
      db,
      buildPick(question.id, profile.id, { side: 'yes', yesPriceAtEntry: 0.15, result: 'win' }),
    );
    expect(await countCalledItPicks(db, profile.id, threshold)).toBe(1);
  });

  it('does not count the same win while the daily is only LOCKED (not yet revealed) — no pre-reveal leak', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(db, buildQuestion(market.id, { status: 'locked' }));
    await insertPick(
      db,
      buildPick(question.id, profile.id, { side: 'yes', yesPriceAtEntry: 0.1, result: 'win' }),
    );
    expect(await countCalledItPicks(db, profile.id, threshold)).toBe(0);
  });

  it('counts a bonus question win immediately regardless of reveal state (§8.8.1 — no held reveal)', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { kind: 'nemesis_bonus', questionDate: null, status: 'locked' }),
    );
    await insertPick(
      db,
      buildPick(question.id, profile.id, { side: 'no', yesPriceAtEntry: 0.85, result: 'win' }),
    );
    expect(await countCalledItPicks(db, profile.id, threshold)).toBe(1);
  });

  it('zero above the threshold, and zero when the pick was undone/hidden (is_public=false)', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const chalky = await insertQuestion(
      db,
      buildQuestion(market.id, {
        status: 'revealed',
        revealedAt: new Date(),
        questionDate: '2026-02-01',
      }),
    );
    await insertPick(
      db,
      buildPick(chalky.id, profile.id, { side: 'yes', yesPriceAtEntry: 0.6, result: 'win' }),
    );
    expect(await countCalledItPicks(db, profile.id, threshold)).toBe(0);

    const hidden = await insertQuestion(
      db,
      buildQuestion(market.id, {
        status: 'revealed',
        revealedAt: new Date(),
        questionDate: '2026-02-02',
      }),
    );
    await insertPick(
      db,
      buildPick(hidden.id, profile.id, {
        side: 'yes',
        yesPriceAtEntry: 0.1,
        result: 'win',
        isPublic: false,
      }),
    );
    expect(await countCalledItPicks(db, profile.id, threshold)).toBe(0);
  });
});

describe('getNemesisSummaryForProfile (§8.8)', () => {
  it('counts wins/losses/draws from both canonical sides, only for completed pairings', async () => {
    const me = await insertProfile(db, buildProfile());
    const rivalA = await insertProfile(db, buildProfile());
    const rivalB = await insertProfile(db, buildProfile());
    const rivalC = await insertProfile(db, buildProfile());
    const season = {
      id: uuidv7(),
      kind: 'nemesis' as const,
      startsOn: '2026-01-05',
      endsOn: '2026-03-27',
      name: 'S1',
    };
    await db.insert(seasons).values(season);

    // Win as profile_a.
    await db.insert(nemesisPairings).values({
      id: uuidv7(),
      seasonId: season.id,
      weekStart: '2026-01-05',
      profileAId: me.id,
      profileBId: rivalA.id,
      status: 'completed',
      winnerProfileId: me.id,
    });
    // Loss as profile_b.
    await db.insert(nemesisPairings).values({
      id: uuidv7(),
      seasonId: season.id,
      weekStart: '2026-01-12',
      profileAId: rivalB.id,
      profileBId: me.id,
      status: 'completed',
      winnerProfileId: rivalB.id,
    });
    // Draw.
    await db.insert(nemesisPairings).values({
      id: uuidv7(),
      seasonId: season.id,
      weekStart: '2026-01-19',
      profileAId: me.id,
      profileBId: rivalC.id,
      status: 'completed',
      winnerProfileId: null,
    });
    // Still active — must not count.
    await db.insert(nemesisPairings).values({
      id: uuidv7(),
      seasonId: season.id,
      weekStart: '2026-01-26',
      profileAId: me.id,
      profileBId: rivalA.id,
      status: 'active',
    });

    expect(await getNemesisSummaryForProfile(db, me.id)).toEqual({ wins: 1, losses: 1, draws: 1 });
  });

  it('is all-zero for a profile with no completed pairings', async () => {
    const me = await insertProfile(db, buildProfile());
    expect(await getNemesisSummaryForProfile(db, me.id)).toEqual({ wins: 0, losses: 0, draws: 0 });
  });
});

// `getActiveWalletLinkByProfileId` moved to `./wallet-links.js` (WS12, landed after this task
// started) — it's exercised there via `verifyWalletLink`/`unlinkWallet`
// (apps/web/test/integration/wallet-flow.test.ts), not duplicated here.
