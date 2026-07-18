/**
 * WS1-T4 integration: `venue:sync-catalog` upserts candidate markets (§7.5) and flags
 * question-referenced markets missing from the feed as `stale_in_feed` rather than deleting
 * them. Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import { MockVenueAdapter } from '@receipts/venues/mock';
import { runVenueSyncCatalog } from '../../src/jobs/venue-sync-catalog.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-19T10:10:00Z');

let pool: pg.Pool;
let db: Db;

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
});

afterAll(async () => {
  await pool.end();
});

describe('venue:sync-catalog (§7.5)', () => {
  it('upserts a candidate market from the adapter feed', async () => {
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({
      venueMarketId: 'SYNC-KNOWN-1',
      title: 'Sync test market',
      liquidityUsd: 5_000,
      yesPrice: 0.55,
      closeTime: new Date(NOW.getTime() + 24 * 3600_000),
    });

    const reports = await runVenueSyncCatalog(db, [adapter], NOW);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ venue: 'kalshi', listed: 1, upserted: 1, staleFlagged: 0 });

    const row = await db.execute(
      sql`SELECT yes_price, title FROM markets WHERE venue = 'kalshi' AND venue_market_id = 'SYNC-KNOWN-1'`,
    );
    expect(row.rows).toHaveLength(1);
    expect(Number(row.rows[0]!['yes_price'])).toBeCloseTo(0.55, 5);
    expect(row.rows[0]!['title']).toBe('Sync test market');
  });

  it('re-syncing updates the same row in place (idempotent upsert, price refreshed)', async () => {
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({
      venueMarketId: 'SYNC-KNOWN-1',
      title: 'Sync test market',
      liquidityUsd: 5_000,
      yesPrice: 0.72,
      closeTime: new Date(NOW.getTime() + 24 * 3600_000),
    });

    await runVenueSyncCatalog(db, [adapter], new Date(NOW.getTime() + 60_000));

    const rows = await db.execute(
      sql`SELECT yes_price FROM markets WHERE venue = 'kalshi' AND venue_market_id = 'SYNC-KNOWN-1'`,
    );
    expect(rows.rows).toHaveLength(1); // still one row, not duplicated
    expect(Number(rows.rows[0]!['yes_price'])).toBeCloseTo(0.72, 5);
  });

  it('flags a question-referenced market missing from the feed as stale_in_feed, keeping it', async () => {
    const staleMarket = buildMarket({ venue: 'kalshi', venueMarketId: 'SYNC-STALE-1' });
    await db.insert(markets).values(staleMarket);
    const question = buildQuestion(staleMarket.id as string, {});
    await db.insert(questions).values(question);

    const adapter = new MockVenueAdapter('kalshi'); // empty feed this sync
    const reports = await runVenueSyncCatalog(db, [adapter], NOW);
    expect(reports[0]).toMatchObject({ venue: 'kalshi', staleFlagged: 1 });

    const row = await db.execute(sql`SELECT raw FROM markets WHERE id = ${staleMarket.id}`);
    expect(row.rows[0]!['raw']).toMatchObject({ stale_in_feed: true });

    // The row still exists (kept, not deleted) and is still referenced by the question.
    const stillReferenced = await db.execute(
      sql`SELECT market_id FROM questions WHERE id = ${question.id}`,
    );
    expect(stillReferenced.rows[0]!['market_id']).toBe(staleMarket.id);
  });

  it('clears stale_in_feed once the market reappears in the feed', async () => {
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({
      venueMarketId: 'SYNC-STALE-1',
      title: 'Back in the feed',
      liquidityUsd: 2_000,
      yesPrice: 0.4,
      closeTime: new Date(NOW.getTime() + 24 * 3600_000),
    });
    await runVenueSyncCatalog(db, [adapter], NOW);

    const row = await db.execute(
      sql`SELECT raw FROM markets WHERE venue = 'kalshi' AND venue_market_id = 'SYNC-STALE-1'`,
    );
    expect(row.rows[0]!['raw']).not.toHaveProperty('stale_in_feed');
  });
});
