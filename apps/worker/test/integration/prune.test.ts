/**
 * WS0-T4 integration: `maintenance:prune` implements the §11.5 data-lifecycle table.
 * Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '@receipts/db';
import {
  buildMarket,
  buildPick,
  buildProfile,
  buildQuestion,
} from '@receipts/db/testing';
import { runMaintenancePrune } from '../../src/jobs/maintenance-prune.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

/** Fixed "now" for the prune run. */
const NOW = new Date('2026-07-19T08:30:00Z');

function monthsAgo(months: number): Date {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 3600_000);
}

let pool: pg.Pool;
let db: Db;

// Fixture ids we assert on.
const expiredGhostId = uuidv7();
const freshGhostId = uuidv7();
let openQuestionId: string;
let revealedQuestionId: string;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });

  const { profiles, markets, questions, picks, marketPriceSnapshots, auditLog } = await import(
    '@receipts/db'
  );

  // --- Profiles: one 14-months-unseen ghost, one fresh ghost ---------------------------------
  await db.insert(profiles).values([
    buildProfile({ id: expiredGhostId, lastSeenAt: monthsAgo(14) }),
    buildProfile({ id: freshGhostId, lastSeenAt: NOW }),
  ]);

  // --- Questions: one open (with counters), one revealed -------------------------------------
  const market = buildMarket();
  await db.insert(markets).values(market);
  const openQ = buildQuestion(market.id as string, { status: 'open', yesCount: 2, noCount: 0 });
  const revealedQ = buildQuestion(market.id as string, {
    status: 'revealed',
    outcome: 'yes',
    yesCount: 1,
    noCount: 0,
    revealedAt: daysAgo(30),
  });
  await db.insert(questions).values([openQ, revealedQ]);
  openQuestionId = openQ.id as string;
  revealedQuestionId = revealedQ.id as string;

  await db.insert(picks).values([
    // Expired ghost's pick on a still-open question → must be deleted + counter decremented.
    buildPick(openQuestionId, expiredGhostId, { side: 'yes' }),
    // Fresh ghost's pick on the same open question → untouched.
    buildPick(openQuestionId, freshGhostId, { side: 'yes' }),
    // Expired ghost's pick on a revealed question → kept, public (settled history).
    buildPick(revealedQuestionId, expiredGhostId, {
      side: 'yes',
      result: 'win',
      edge: 0.4,
      gradedAt: daysAgo(30),
    }),
  ]);

  // --- Price snapshots: one 100 days old (pruned), one 10 days old (kept) --------------------
  await db.insert(marketPriceSnapshots).values([
    { marketId: market.id as string, ts: daysAgo(100), yesPrice: 0.5 },
    { marketId: market.id as string, ts: daysAgo(10), yesPrice: 0.6 },
  ]);

  // --- Analytics: partitions + rows with hashes ----------------------------------------------
  // Partition 14 months back (must be dropped) and the 10-days-ago month (hash nulling).
  const old = monthsAgo(14);
  await db.execute(sql`
    SELECT ensure_analytics_events_partition(date_trunc('month', ${old.toISOString()}::timestamptz)::date)
  `);
  await db.execute(sql`
    SELECT ensure_analytics_events_partition(date_trunc('month', ${daysAgo(10).toISOString()}::timestamptz)::date)
  `);
  await db.execute(sql`
    SELECT ensure_analytics_events_partition(date_trunc('month', ${NOW.toISOString()}::timestamptz)::date)
  `);
  await db.execute(sql`
    INSERT INTO analytics_events (ts, event, props, ip_hash, ua_hash)
    VALUES
      (${daysAgo(10).toISOString()}::timestamptz, 'spectator_view', '{}', 'old-ip-hash', 'old-ua-hash'),
      (${daysAgo(1).toISOString()}::timestamptz, 'spectator_view', '{}', 'fresh-ip-hash', 'fresh-ua-hash')
  `);

  // --- Audit log: 25 months old (pruned) + fresh (kept) --------------------------------------
  await db.insert(auditLog).values([
    { action: 'old_action', target: 'x', ts: monthsAgo(25) },
    { action: 'fresh_action', target: 'y', ts: daysAgo(1) },
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe('maintenance:prune (§11.5)', () => {
  it('runs the full lifecycle sweep with the expected report', async () => {
    const report = await runMaintenancePrune(db, NOW);
    expect(report.ghostsAnonymized).toBe(1);
    expect(report.openPicksDeleted).toBe(1);
    expect(report.priceSnapshotsDeleted).toBe(1);
    expect(report.ipUaHashesNulled).toBe(1);
    expect(report.analyticsPartitionsDropped).toHaveLength(1);
    expect(report.auditRowsDeleted).toBe(1);
  });

  it('anonymized the expired ghost (handle/slug → expired-{uuid}, secret nulled)', async () => {
    const res = await db.execute(sql`SELECT * FROM profiles WHERE id = ${expiredGhostId}`);
    const row = res.rows[0]!;
    expect(row['handle']).toBe(`expired-${expiredGhostId}`);
    expect(row['slug']).toBe(`expired-${expiredGhostId}`);
    expect(row['ghost_secret_hash']).toBeNull();
    // Fresh ghost untouched.
    const fresh = await db.execute(sql`SELECT handle FROM profiles WHERE id = ${freshGhostId}`);
    expect(fresh.rows[0]!['handle']).not.toMatch(/^expired-/);
  });

  it('deleted the open-question pick with a counter decrement; kept the fresh pick', async () => {
    const q = await db.execute(sql`SELECT yes_count, no_count FROM questions WHERE id = ${openQuestionId}`);
    expect(q.rows[0]!['yes_count']).toBe(1); // 2 → 1
    const remaining = await db.execute(
      sql`SELECT profile_id FROM picks WHERE question_id = ${openQuestionId}`,
    );
    expect(remaining.rows.map((r) => r['profile_id'])).toEqual([freshGhostId]);
  });

  it('kept the revealed-question pick, public (settled history, §11.5)', async () => {
    const res = await db.execute(
      sql`SELECT is_public FROM picks WHERE question_id = ${revealedQuestionId} AND profile_id = ${expiredGhostId}`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!['is_public']).toBe(true);
  });

  it('pruned only price snapshots past 90 days', async () => {
    const res = await db.execute(sql`SELECT ts FROM market_price_snapshots`);
    expect(res.rows).toHaveLength(1);
  });

  it('nulled ip/ua hashes older than 7 days, kept fresh ones', async () => {
    const res = await db.execute(sql`SELECT ts, ip_hash, ua_hash FROM analytics_events ORDER BY ts`);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]!['ip_hash']).toBeNull();
    expect(res.rows[0]!['ua_hash']).toBeNull();
    expect(res.rows[1]!['ip_hash']).toBe('fresh-ip-hash');
  });

  it('dropped only fully-expired analytics partitions and ensured the horizon', async () => {
    const res = await db.execute(sql`
      SELECT inhrelid::regclass::text AS name FROM pg_inherits
      WHERE inhparent = 'analytics_events'::regclass ORDER BY 1
    `);
    const names = res.rows.map((r) => r['name'] as string);
    // 14-months-ago partition gone; current + next month present.
    const cur = `analytics_events_${NOW.getUTCFullYear()}_${String(NOW.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(names).toContain(cur);
    const old = monthsAgo(14);
    const oldName = `analytics_events_${old.getUTCFullYear()}_${String(old.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(names).not.toContain(oldName);
  });

  it('pruned audit_log past 24 months', async () => {
    const res = await db.execute(sql`SELECT action FROM audit_log`);
    expect(res.rows.map((r) => r['action'])).toEqual(['fresh_action']);
  });

  it('is idempotent — a second run is a no-op', async () => {
    const report = await runMaintenancePrune(db, NOW);
    expect(report.ghostsAnonymized).toBe(0);
    expect(report.openPicksDeleted).toBe(0);
    expect(report.priceSnapshotsDeleted).toBe(0);
    expect(report.ipUaHashesNulled).toBe(0);
    expect(report.analyticsPartitionsDropped).toHaveLength(0);
    expect(report.auditRowsDeleted).toBe(0);
  });
});
