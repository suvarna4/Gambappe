/**
 * WS2-T3 integration: `mergeGhostIntoProfile` (§6.4) against a real Postgres — dedupe (both G
 * and P picked the same open question → P's pick stands, G's deleted, counters correct),
 * reparenting of `streak_freeze_uses`/`reactions`/`placement_answers` (dedupe, P wins), and the
 * post-merge §6.6 streak replay. Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  getProfileById,
  markets,
  mergeGhostIntoProfile,
  picks,
  placementAnswers,
  placementItems,
  profiles,
  questions,
  reactions,
  streakFreezeUses,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';

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

describe('mergeGhostIntoProfile (§6.4)', () => {
  it("reassigns non-conflicting picks, dedupes conflicting ones with a counter decrement, reparents freeze/reaction/placement rows (dedupe, P wins), and replays P's streak", async () => {
    const market = buildMarket();
    const g = buildProfile({ handle: 'Ghost #0001' });
    const p = buildProfile({ kind: 'claimed', handle: 'Claimed #0002', ghostSecretHash: null });
    await db.insert(profiles).values([g, p]);
    await db.insert(markets).values(market);

    // --- Three consecutive revealed dailies: G has D1, P has D2+D3 → merged run should be 3 ---
    const d1 = buildQuestion(market.id as string, { questionDate: '2026-02-01', status: 'revealed' });
    const d2 = buildQuestion(market.id as string, { questionDate: '2026-02-02', status: 'revealed' });
    const d3 = buildQuestion(market.id as string, { questionDate: '2026-02-03', status: 'revealed' });
    // Open question both G and P pick (dedupe case) — G picked 'yes', P picked 'no'.
    const openQ = buildQuestion(market.id as string, {
      questionDate: '2026-02-10',
      status: 'open',
      yesCount: 1,
      noCount: 1,
    });
    await db.insert(questions).values([d1, d2, d3, openQ]);

    await db.insert(picks).values([
      buildPick(d1.id as string, g.id as string, { side: 'yes', result: 'win' }),
      buildPick(d2.id as string, p.id as string, { side: 'yes', result: 'win' }),
      buildPick(d3.id as string, p.id as string, { side: 'yes', result: 'win' }),
      buildPick(openQ.id as string, g.id as string, { side: 'yes', result: 'pending' }),
      buildPick(openQ.id as string, p.id as string, { side: 'no', result: 'pending' }),
    ]);

    // --- streak_freeze_uses: G has one G-only date; both have a conflicting date (P wins) -----
    await db.insert(streakFreezeUses).values([
      { profileId: g.id as string, coveredDate: '2026-03-01', usedAt: new Date('2026-03-01T04:00:00Z') },
      { profileId: g.id as string, coveredDate: '2026-03-05', usedAt: new Date('2026-03-05T04:00:00Z') },
      { profileId: p.id as string, coveredDate: '2026-03-05', usedAt: new Date('2026-03-05T04:00:01Z') },
    ]);

    // --- reactions: G-only reaction reparents; conflicting (same context+emoji) dedupes --------
    await db.insert(reactions).values([
      { id: uuidv7(), contextKind: 'question', contextId: d1.id as string, profileId: g.id as string, emoji: '🔥' },
      { id: uuidv7(), contextKind: 'question', contextId: d2.id as string, profileId: g.id as string, emoji: '🧾' },
      { id: uuidv7(), contextKind: 'question', contextId: d2.id as string, profileId: p.id as string, emoji: '🧾' },
    ]);

    // --- placement_answers: G-only reparents; conflicting placement item dedupes ---------------
    const item1 = {
      id: uuidv7(),
      title: 'Item 1',
      category: 'sports' as const,
      yesLabel: 'Yes',
      noLabel: 'No',
      historicalYesPrice: 0.5,
      historicalCrowdYesPct: 0.5,
      outcome: 'yes' as const,
      resolvedOn: '2025-01-01',
    };
    const item2 = { ...item1, id: uuidv7(), title: 'Item 2' };
    await db.insert(placementItems).values([item1, item2]);
    await db.insert(placementAnswers).values([
      { profileId: g.id as string, placementItemId: item1.id, side: 'yes' },
      { profileId: g.id as string, placementItemId: item2.id, side: 'yes' },
      { profileId: p.id as string, placementItemId: item2.id, side: 'no' },
    ]);

    const result = await mergeGhostIntoProfile(
      db,
      g.id as string,
      p.id as string,
      new Date('2026-03-10T00:00:00Z'),
    );

    expect(result.picksReassigned).toBe(1); // D1
    expect(result.picksDeduped).toBe(1); // openQ

    // Counter decrement: G's 'yes' pick on the still-open question was dropped.
    const [openAfter] = await db.select().from(questions).where(eq(questions.id, openQ.id as string));
    expect(openAfter!.yesCount).toBe(0);
    expect(openAfter!.noCount).toBe(1); // P's 'no' pick stands, untouched

    // D1's pick now belongs to P.
    const pPicks = await db.select().from(picks).where(eq(picks.profileId, p.id as string));
    expect(pPicks.map((r) => r.questionId).sort()).toEqual(
      [d1.id, d2.id, d3.id, openQ.id].sort() as string[],
    );

    // Freeze uses: P has both dates, G has none left; conflicting date kept P's own usedAt.
    const gFreeze = await db.select().from(streakFreezeUses).where(eq(streakFreezeUses.profileId, g.id as string));
    expect(gFreeze).toHaveLength(0);
    const pFreeze = await db.select().from(streakFreezeUses).where(eq(streakFreezeUses.profileId, p.id as string));
    expect(pFreeze.map((r) => r.coveredDate).sort()).toEqual(['2026-03-01', '2026-03-05']);
    const conflict = pFreeze.find((r) => r.coveredDate === '2026-03-05')!;
    expect(conflict.usedAt.toISOString()).toBe(new Date('2026-03-05T04:00:01Z').toISOString());

    // Reactions: G's unique reaction reparented; conflicting one deduped (P's stands, one row).
    const gReactions = await db.select().from(reactions).where(eq(reactions.profileId, g.id as string));
    expect(gReactions).toHaveLength(0);
    const pReactions = await db.select().from(reactions).where(eq(reactions.profileId, p.id as string));
    expect(pReactions).toHaveLength(2); // d1/🔥 (reparented) + d2/🧾 (P's own, G's deduped away)

    // Placement answers: G's unique answer reparented; conflicting one deduped (P's stands).
    const gAnswers = await db.select().from(placementAnswers).where(eq(placementAnswers.profileId, g.id as string));
    expect(gAnswers).toHaveLength(0);
    const pAnswers = await db.select().from(placementAnswers).where(eq(placementAnswers.profileId, p.id as string));
    expect(pAnswers.map((a) => a.placementItemId).sort()).toEqual([item1.id, item2.id].sort());
    const item2Answer = pAnswers.find((a) => a.placementItemId === item2.id)!;
    expect(item2Answer.side).toBe('no'); // P's own answer wins, not G's 'yes'

    // Streak replay: P now has D1(win), D2(win), D3(win) consecutive → 3/3/D3, win streak 3.
    const merged = await getProfileById(db, p.id as string);
    expect(merged!.currentStreak).toBe(3);
    expect(merged!.bestStreak).toBe(3);
    expect(merged!.lastCountedDate).toBe('2026-02-03');
    expect(merged!.currentWinStreak).toBe(3);
    expect(merged!.bestWinStreak).toBe(3);

    // G is marked merged/deleted.
    const ghostAfter = await getProfileById(db, g.id as string);
    expect(ghostAfter!.status).toBe('deleted');
    expect(ghostAfter!.mergedIntoProfileId).toBe(p.id);
    expect(ghostAfter!.ghostSecretHash).toBeNull();
  });
});
