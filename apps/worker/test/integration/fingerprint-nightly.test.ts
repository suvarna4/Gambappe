/**
 * WS4-T7 integration: `fingerprint:nightly` rebuilds `fingerprints` from graded pick history via
 * the WS4-T1 pure `computeFingerprint`, and derives `ratings.accuracy_percentile` (§8.3) for
 * profiles with >= ACCURACY_PERCENTILE_MIN_PICKS graded picks. Requires a live Postgres
 * (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { ACCURACY_PERCENTILE_MIN_PICKS } from '@receipts/core';
import { connect, fingerprints, markets, picks, profiles, questions, ratings, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { runFingerprintNightly } from '../../src/jobs/fingerprint-nightly.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-19T07:00:00Z'); // 03:00 ET

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
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

/** Inserts `n` graded picks for `profileId`, `winCount` of them wins, each its own market+question. */
async function insertGradedPicks(
  profileId: string,
  n: number,
  winCount: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const won = i < winCount;
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'revealed' });
    await db.insert(questions).values(question);
    const side = won ? 'yes' : 'no';
    const entry = 0.5;
    await db.insert(picks).values(
      buildPick(question.id as string, profileId, {
        side,
        yesPriceAtEntry: entry,
        result: won ? 'win' : 'loss',
        edge: computeEdge(side, entry, won),
        gradedAt: NOW,
      }),
    );
  }
}

describe('fingerprint:nightly (§8.1)', () => {
  it('rebuilds fingerprints for every profile with >=1 graded pick', async () => {
    const profile = buildProfile();
    await db.insert(profiles).values(profile);
    await insertGradedPicks(profile.id as string, 4, 3); // 3 wins, 1 loss => accuracy 0.75

    const report = await runFingerprintNightly(db, NOW);
    expect(report.profilesRebuilt).toBeGreaterThanOrEqual(1);
    expect(report.failures).toBe(0);

    const [row] = await db.select().from(fingerprints).where(sql`${fingerprints.profileId} = ${profile.id}`);
    expect(row).toBeDefined();
    expect(row!.resolvedPickCount).toBe(4);
    expect(row!.accuracy).toBeCloseTo(0.75, 10);
    expect(row!.computedAt.getTime()).toBe(NOW.getTime());
  });

  it('excludes deleted profiles from the rebuild (never resurrects their fingerprints row)', async () => {
    const profile = buildProfile({ status: 'deleted' });
    await db.insert(profiles).values(profile);
    await insertGradedPicks(profile.id as string, 2, 1);

    await runFingerprintNightly(db, NOW);

    const [row] = await db.select().from(fingerprints).where(sql`${fingerprints.profileId} = ${profile.id}`);
    expect(row).toBeUndefined();
  });

  it('sets ratings.accuracy_percentile only for profiles with >= ACCURACY_PERCENTILE_MIN_PICKS graded picks, ranked among each other', async () => {
    const best = buildProfile();
    const worst = buildProfile();
    const tooFew = buildProfile();
    await db.insert(profiles).values([best, worst, tooFew]);

    // Both `best` and `worst` clear the ACCURACY_PERCENTILE_MIN_PICKS bar; `best` wins them all,
    // `worst` loses them all — `best` must rank strictly above `worst`.
    await insertGradedPicks(best.id as string, ACCURACY_PERCENTILE_MIN_PICKS, ACCURACY_PERCENTILE_MIN_PICKS);
    await insertGradedPicks(worst.id as string, ACCURACY_PERCENTILE_MIN_PICKS, 0);
    // `tooFew` has graded picks but stays below the threshold.
    await insertGradedPicks(tooFew.id as string, ACCURACY_PERCENTILE_MIN_PICKS - 1, 1);

    const report = await runFingerprintNightly(db, NOW);
    expect(report.percentilesWritten).toBeGreaterThanOrEqual(2);

    const [bestRating] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${best.id}`);
    const [worstRating] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${worst.id}`);
    const [tooFewRating] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${tooFew.id}`);

    expect(bestRating!.accuracyPercentile).not.toBeNull();
    expect(worstRating!.accuracyPercentile).not.toBeNull();
    expect(bestRating!.accuracyPercentile!).toBeGreaterThan(worstRating!.accuracyPercentile!);
    // `tooFew` never clears the eligibility bar, so no ratings row is created for it at all.
    expect(tooFewRating).toBeUndefined();
  });

  it('is a full recompute: a second run with unchanged pick history yields identical output', async () => {
    const profile = buildProfile();
    await db.insert(profiles).values(profile);
    await insertGradedPicks(profile.id as string, 5, 4);

    await runFingerprintNightly(db, NOW);
    const [first] = await db.select().from(fingerprints).where(sql`${fingerprints.profileId} = ${profile.id}`);

    const LATER = new Date(NOW.getTime() + 24 * 3600_000);
    await runFingerprintNightly(db, LATER);
    const [second] = await db.select().from(fingerprints).where(sql`${fingerprints.profileId} = ${profile.id}`);

    expect(second!.accuracy).toBe(first!.accuracy);
    expect(second!.resolvedPickCount).toBe(first!.resolvedPickCount);
    expect(second!.computedAt.getTime()).toBe(LATER.getTime()); // recomputed_at DOES advance
  });
});
