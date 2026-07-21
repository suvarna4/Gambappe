/**
 * WS19-T2 integration: `getSweatPositions` (`lib/sweat-feed.ts`) against real Postgres — the
 * viewer's `pending` picks joined to questions + markets, ordered soonest-to-settle first, with
 * held-side entry cents, drift, and the settle-when label. Mirrors `question-view.test.ts`'s
 * migrate-a-fresh-schema harness. No Redis needed (pure DB read).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { getSweatPositions } from '../../lib/sweat-feed.js';

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
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE picks, questions, markets, profiles RESTART IDENTITY CASCADE`);
});

let seq = 0;
async function seedProfile(): Promise<string> {
  const u = `${Date.now()}-${seq++}`;
  const profile = buildProfile({ handle: `Sweater ${u}`, slug: `sweater-${u}` });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

async function seedPending(
  profileId: string,
  opts: { closeTime: Date; side?: 'yes' | 'no'; entry?: number; yesPriceNow?: number },
): Promise<void> {
  const market = buildMarket({
    venueMarketId: `KX-${Math.random()}`,
    status: 'open',
    closeTime: opts.closeTime,
    yesPrice: opts.yesPriceNow ?? 0.63,
  });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, { questionDate: null, status: 'locked' });
  await db.insert(questions).values(question);
  await db.insert(picks).values(
    buildPick(question.id as string, profileId, {
      side: opts.side ?? 'yes',
      yesPriceAtEntry: opts.entry ?? 0.6,
      result: 'pending',
    }),
  );
}

describe('getSweatPositions', () => {
  it('returns only the viewer’s pending picks, soonest-to-settle first', async () => {
    const me = await seedProfile();
    const other = await seedProfile();
    const now = Date.now();

    await seedPending(me, { closeTime: new Date(now + 90 * 24 * 3600_000) }); // month
    await seedPending(me, { closeTime: new Date(now + 60 * 60_000) }); // live
    await seedPending(me, { closeTime: new Date(now + 3 * 24 * 3600_000) }); // weekday
    await seedPending(other, { closeTime: new Date(now + 60 * 60_000) }); // not mine

    const positions = await getSweatPositions(db, me, now);
    expect(positions).toHaveLength(3);
    expect(positions.map((p) => p.settleWhen.kind)).toEqual(['live', 'weekday', 'month']);
  });

  it('excludes graded (win/loss/void) picks — only open positions are a sweat', async () => {
    const me = await seedProfile();
    const now = Date.now();
    const market = buildMarket({ venueMarketId: `KX-graded-${Math.random()}`, status: 'resolved' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { questionDate: null, status: 'revealed' });
    await db.insert(questions).values(question);
    await db
      .insert(picks)
      .values(buildPick(question.id as string, me, { result: 'win', edge: 0.2 }));

    expect(await getSweatPositions(db, me, now)).toHaveLength(0);
  });

  it('computes held-side entry + drift; a rising YES helps a YES holder, hurts a NO holder', async () => {
    const me = await seedProfile();
    const now = Date.now();
    const soon = new Date(now + 60 * 60_000);
    await seedPending(me, { closeTime: soon, side: 'yes', entry: 0.6, yesPriceNow: 0.7 });
    await seedPending(me, { closeTime: soon, side: 'no', entry: 0.6, yesPriceNow: 0.7 });

    const positions = await getSweatPositions(db, me, now);
    const yes = positions.find((p) => p.side === 'yes')!;
    const no = positions.find((p) => p.side === 'no')!;
    expect(yes.entryCents).toBe(60);
    expect(yes.drift).toEqual({ cents: 10, direction: 'up' });
    expect(no.entryCents).toBe(40); // 100 − 60
    expect(no.drift).toEqual({ cents: -10, direction: 'down' });
  });
});
