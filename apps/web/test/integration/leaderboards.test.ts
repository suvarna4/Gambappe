/**
 * WS3-T7 integration: `getLeaderboardPicksForWeek` + `rankLeaderboard` composed against a real
 * Postgres — "unrevealed picks excluded" (the DB-query half of the eligibility story; the
 * claimed/bot/min-picks gates are covered at the unit level, `test/leaderboards.test.ts`).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, getLeaderboardPicksForWeek, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { rankLeaderboard } from '@/lib/leaderboards';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

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

describe('getLeaderboardPicksForWeek (§8.12)', () => {
  it('excludes unrevealed (open/locked) and void/pending picks; includes revealed win/loss', async () => {
    const claimed = buildProfile({ kind: 'claimed', ghostSecretHash: null });
    await db.insert(profiles).values(claimed);

    const revealedMarket = buildMarket({ category: 'sports' });
    await db.insert(markets).values(revealedMarket);
    const revealedQ = buildQuestion(revealedMarket.id as string, {
      questionDate: '2026-09-07', // a Monday
      status: 'revealed',
    });
    await db.insert(questions).values(revealedQ);

    const lockedMarket = buildMarket({ category: 'sports' });
    await db.insert(markets).values(lockedMarket);
    const lockedQ = buildQuestion(lockedMarket.id as string, {
      questionDate: '2026-09-08',
      status: 'locked', // graded internally but not yet revealed — must be excluded
    });
    await db.insert(questions).values(lockedQ);

    await db.insert(picks).values([
      buildPick(revealedQ.id as string, claimed.id as string, { result: 'win', edge: 0.4 }),
      buildPick(lockedQ.id as string, claimed.id as string, { result: 'win', edge: 0.4 }),
    ]);

    const rows = await getLeaderboardPicksForWeek(db, '2026-09-07', '2026-09-13');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toBe('win');
  });

  it('composes with rankLeaderboard end to end: eligible claimed profile with 3+ revealed wins ranks', async () => {
    const claimed = buildProfile({ kind: 'claimed', ghostSecretHash: null });
    await db.insert(profiles).values(claimed);

    for (let i = 0; i < 3; i++) {
      const market = buildMarket({ category: 'politics' });
      await db.insert(markets).values(market);
      const q = buildQuestion(market.id as string, { questionDate: `2026-09-1${4 + i}`, status: 'revealed' });
      await db.insert(questions).values(q);
      await db.insert(picks).values(buildPick(q.id as string, claimed.id as string, { result: 'win', edge: 0.3 }));
    }

    const rows = await getLeaderboardPicksForWeek(db, '2026-09-14', '2026-09-20');
    const board = rankLeaderboard(rows, 'overall');
    expect(board).toHaveLength(1);
    expect(board[0]!.wins).toBe(3);
    expect(board[0]!.profile.profile_id).toBe(claimed.id);
  });
});
