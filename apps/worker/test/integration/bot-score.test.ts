/**
 * WS11-T2 integration AC ("fixture-driven"): a synthetic bot-pattern profile and a
 * human-pattern profile, seeded into real Postgres, run through the full computeBotScores
 * pipeline (not just the pure combiner) — proving the SQL signal extraction, not only the
 * combining math, produces the right thresholds.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, analyticsEvents, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion } from '@receipts/db/testing';
import { BOT_EXCLUDE_THRESHOLD } from '@receipts/core';
import { computeBotScores } from '../../src/jobs/bot-score.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const AT = new Date('2026-07-06T00:00:00Z'); // "tonight" the job runs; lookback covers 06-22..07-06

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
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

const UA_HASHES = Array.from({ length: 8 }, (_, i) => `ua-hash-${i}`);

async function insertPicksWithLatency(db: Db, profileId: string, latenciesMs: number[]) {
  for (const latencyMs of latenciesMs) {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string);
    await db.insert(questions).values(question);
    const priceStampedAt = new Date('2026-07-01T12:00:00Z');
    await db.insert(picks).values({
      id: uuidv7(),
      questionId: question.id as string,
      profileId,
      side: 'yes',
      yesPriceAtEntry: 0.5,
      priceStampedAt,
      pickedAt: new Date(priceStampedAt.getTime() + latencyMs),
    });
  }
}

describe('computeBotScores (§14.2, fixture-driven)', () => {
  it('scores a synthetic bot pattern >= 0.8 and a human pattern <= 0.3', async () => {
    const bot = buildProfile();
    const human = buildProfile();
    await db.insert(profiles).values([bot, human]);

    // --- Bot: sub-second uniform pick latency ---
    await insertPicksWithLatency(db, bot.id as string, [180, 190, 200, 210, 200, 195, 205, 200, 190, 210]);

    // --- Bot: IP fan-out — 14 other (unregistered) profile ids sharing one ip_hash/day ---
    const fanoutDay = new Date('2026-07-01T08:00:00Z');
    const sharedIpHash = 'ip-hash-bot-shared';
    const fillerRows = Array.from({ length: 14 }, () => ({
      ts: fanoutDay,
      event: 'spectator_view',
      profileId: uuidv7(),
      isGhost: true,
      props: {},
      ipHash: sharedIpHash,
      uaHash: 'ua-filler',
    }));

    // --- Bot: 24/7 spread across >=3 distinct days, all 24 hours touched; UA churn ---
    const botRows = [];
    for (let h = 0; h < 12; h++) {
      botRows.push({
        ts: new Date(Date.UTC(2026, 6, 1, h)),
        event: 'spectator_view',
        profileId: bot.id as string,
        isGhost: false,
        props: {},
        ipHash: h === 8 ? sharedIpHash : 'ip-hash-bot-2',
        uaHash: UA_HASHES[h % UA_HASHES.length]!,
      });
    }
    for (let h = 12; h < 24; h++) {
      botRows.push({
        ts: new Date(Date.UTC(2026, 6, 2, h)),
        event: 'spectator_view',
        profileId: bot.id as string,
        isGhost: false,
        props: {},
        ipHash: 'ip-hash-bot-3',
        uaHash: UA_HASHES[h % UA_HASHES.length]!,
      });
    }
    botRows.push({
      ts: new Date(Date.UTC(2026, 6, 3, 0)),
      event: 'spectator_view',
      profileId: bot.id as string,
      isGhost: false,
      props: {},
      ipHash: 'ip-hash-bot-4',
      uaHash: UA_HASHES[0]!,
    });
    await db.insert(analyticsEvents).values([...fillerRows, ...botRows]);

    // --- Human: variable, several-second pick latency ---
    await insertPicksWithLatency(db, human.id as string, [3000, 8000, 15000, 4000, 20000]);

    // --- Human: single ip_hash/ua_hash, a consistent few hours across several days ---
    const humanRows = [];
    for (const day of [1, 2, 3, 4]) {
      for (const hour of [9, 12, 18]) {
        humanRows.push({
          ts: new Date(Date.UTC(2026, 6, day, hour)),
          event: 'spectator_view',
          profileId: human.id as string,
          isGhost: false,
          props: {},
          ipHash: 'ip-hash-human',
          uaHash: 'ua-human',
        });
      }
    }
    await db.insert(analyticsEvents).values(humanRows);

    const scores = await computeBotScores(db, AT);
    const byProfile = new Map(scores.map((s) => [s.profileId, s.score]));

    expect(byProfile.get(bot.id as string)).toBeGreaterThanOrEqual(BOT_EXCLUDE_THRESHOLD);
    expect(byProfile.get(human.id as string)).toBeLessThanOrEqual(0.3);
  });
});
