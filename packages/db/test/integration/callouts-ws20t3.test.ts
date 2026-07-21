/**
 * WS20-T3 (journeys plan §5, D-J5) DB integration: the pieces WS16-T2 didn't ship —
 *
 *  - `declineCallout`: transactional/idempotent flip `pending → declined`; second decline / a
 *    non-pending callout → `already_resolved`; expired-by-time → lazily marked `expired`; missing.
 *  - `getOrCreateNemesisSeasonCovering`: get-or-create used by both `nemesis:assign` and call-out
 *    accept (returns `created` and a correctly-bounded fresh season).
 *  - `listNemesisEligiblePool` call-out double-assignment guard: a profile already holding a
 *    `scheduled`/`active` pairing for the assigned week is excluded from the organic pool (the AC
 *    guard), while a terminal pairing or a pairing for a different week does NOT exclude it.
 *
 * Connects via TEST_DATABASE_URL (dedicated per-agent DB; CI default receipts_test).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { BOT_EXCLUDE_THRESHOLD, NEMESIS_MIN_PICKS, NEMESIS_SEASON_WEEKS } from '@receipts/core';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import {
  createCallout,
  declineCallout,
  getCalloutByTokenHash,
} from '../../src/repositories/callouts.js';
import {
  getOrCreateNemesisSeasonCovering,
  listNemesisEligiblePool,
} from '../../src/repositories/nemesis.js';
import { markets, nemesisPairings, picks, profiles, questions, seasons } from '../../src/schema/index.js';
import {
  buildMarket,
  buildNemesisPairing,
  buildPick,
  buildProfile,
  buildQuestion,
} from '../../src/testing/factories.js';

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
    sql`TRUNCATE callouts, nemesis_pairings, seasons, picks, questions, markets, profiles RESTART IDENTITY CASCADE`,
  );
});

async function seedChallenger(): Promise<string> {
  const p = buildProfile({ kind: 'claimed', status: 'active' });
  await db.insert(profiles).values(p);
  return p.id as string;
}

describe('declineCallout (WS20-T3)', () => {
  it('flips a pending callout to declined without creating a pairing', async () => {
    const challenger = await seedChallenger();
    await createCallout(db, {
      challengerProfileId: challenger,
      tokenHash: 'hash-decline',
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });

    const res = await declineCallout(db, { tokenHash: 'hash-decline' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.callout.status).toBe('declined');
    expect(await db.select().from(nemesisPairings)).toHaveLength(0);
  });

  it('is idempotent/terminal-safe: a second decline returns already_resolved', async () => {
    const challenger = await seedChallenger();
    await createCallout(db, {
      challengerProfileId: challenger,
      tokenHash: 'hash-decline-2',
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });

    expect((await declineCallout(db, { tokenHash: 'hash-decline-2' })).ok).toBe(true);
    expect(await declineCallout(db, { tokenHash: 'hash-decline-2' })).toEqual({
      ok: false,
      reason: 'already_resolved',
    });
  });

  it('reports expired (and lazily marks it) for an expired callout, and not_found for a miss', async () => {
    const challenger = await seedChallenger();
    await createCallout(db, {
      challengerProfileId: challenger,
      tokenHash: 'hash-decline-exp',
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await declineCallout(db, { tokenHash: 'hash-decline-exp' })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect((await getCalloutByTokenHash(db, 'hash-decline-exp'))?.status).toBe('expired');

    expect(await declineCallout(db, { tokenHash: 'nope' })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('getOrCreateNemesisSeasonCovering (WS20-T3 shared with nemesis:assign)', () => {
  it('creates a correctly-bounded season when none covers the date', async () => {
    const { season, created } = await getOrCreateNemesisSeasonCovering(db, '2026-07-27');
    expect(created).toBe(true);
    expect(season.startsOn).toBe('2026-07-27');
    const expectedEnd = new Date('2026-07-27T00:00:00Z');
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() + NEMESIS_SEASON_WEEKS * 7 - 1);
    expect(season.endsOn).toBe(expectedEnd.toISOString().slice(0, 10));
  });

  it('returns the existing covering season without creating a second', async () => {
    const first = await getOrCreateNemesisSeasonCovering(db, '2026-07-27');
    // A date inside the same season window resolves to the same row, created=false.
    const second = await getOrCreateNemesisSeasonCovering(db, '2026-08-03');
    expect(second.created).toBe(false);
    expect(second.season.id).toBe(first.season.id);
    expect(await db.select().from(seasons)).toHaveLength(1);
  });
});

describe('listNemesisEligiblePool call-out guard (WS20-T3 AC, D-J5)', () => {
  const WEEK = '2026-07-27';
  const OTHER_WEEK = '2026-08-03';

  /** A handful of graded (win) dummy dailies so `NEMESIS_MIN_PICKS` is cheap to satisfy. */
  async function gradedQuestionIds(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const m = buildMarket({ status: 'resolved', outcome: 'yes' });
      await db.insert(markets).values(m);
      const q = buildQuestion(m.id as string, { status: 'revealed', outcome: 'yes' });
      await db.insert(questions).values(q);
      ids.push(q.id as string);
    }
    return ids;
  }

  async function seedEligibleProfile(questionIds: string[]): Promise<string> {
    const p = buildProfile({ kind: 'claimed', status: 'active' });
    await db.insert(profiles).values(p);
    for (const questionId of questionIds) {
      await db.insert(picks).values(
        buildPick(questionId, p.id as string, { result: 'win', gradedAt: new Date() }),
      );
    }
    return p.id as string;
  }

  async function insertPairing(
    a: string,
    b: string,
    seasonId: string,
    weekStart: string,
    status: 'scheduled' | 'active' | 'completed',
  ): Promise<void> {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    await db.insert(nemesisPairings).values(
      buildNemesisPairing(seasonId, lo, hi, { weekStart, status, isRematch: false }),
    );
  }

  async function poolIds(weekStart: string): Promise<string[]> {
    const rows = await listNemesisEligiblePool(db, BOT_EXCLUDE_THRESHOLD, NEMESIS_MIN_PICKS, weekStart);
    return rows.map((r) => r.profileId).sort();
  }

  it('excludes profiles already scheduled/active-paired for the assigned week; a third stays', async () => {
    const qs = await gradedQuestionIds(NEMESIS_MIN_PICKS);
    const [a, b, c] = await Promise.all([
      seedEligibleProfile(qs),
      seedEligibleProfile(qs),
      seedEligibleProfile(qs),
    ]);
    const { season } = await getOrCreateNemesisSeasonCovering(db, WEEK);

    // Baseline: all three eligible before any pairing exists.
    expect(await poolIds(WEEK)).toEqual([a, b, c].sort());

    // A scheduled call-out pairing for (a,b) this week removes both from the pool.
    await insertPairing(a, b, season.id, WEEK, 'scheduled');
    expect(await poolIds(WEEK)).toEqual([c]);

    // An active pairing excludes just the same.
    await db.execute(sql`UPDATE nemesis_pairings SET status = 'active'`);
    expect(await poolIds(WEEK)).toEqual([c]);
  });

  it('does NOT exclude for a pairing in a different week or one that is already terminal', async () => {
    const qs = await gradedQuestionIds(NEMESIS_MIN_PICKS);
    const [a, b, c] = await Promise.all([
      seedEligibleProfile(qs),
      seedEligibleProfile(qs),
      seedEligibleProfile(qs),
    ]);
    const { season } = await getOrCreateNemesisSeasonCovering(db, WEEK);

    // Scheduled but for a DIFFERENT week → still eligible for WEEK.
    await insertPairing(a, b, season.id, OTHER_WEEK, 'scheduled');
    expect(await poolIds(WEEK)).toEqual([a, b, c].sort());

    // A completed (terminal) pairing for THIS week → not an active commitment, still eligible.
    await insertPairing(a, c, season.id, WEEK, 'completed');
    expect(await poolIds(WEEK)).toEqual([a, b, c].sort());
  });
});
