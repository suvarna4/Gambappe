/**
 * WS13-T3 integration: `listMetricRollupsForRange` against real Postgres (§13.3 metrics page).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { listMetricRollupsForRange, replaceMetricRollupsForDate } from '../../src/repositories/metric-rollups.js';

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
  await db.execute(sql`TRUNCATE metric_rollups RESTART IDENTITY CASCADE`);
});

describe('listMetricRollupsForRange (§13.3)', () => {
  it('returns only rows within [startDate, endDate], ordered by date', async () => {
    await replaceMetricRollupsForDate(db, '2026-07-10', [{ metric: 'dau', value: 100 }]);
    await replaceMetricRollupsForDate(db, '2026-07-14', [{ metric: 'dau', value: 120 }]);
    await replaceMetricRollupsForDate(db, '2026-07-16', [{ metric: 'dau', value: 150 }]);
    await replaceMetricRollupsForDate(db, '2026-07-20', [{ metric: 'dau', value: 200 }]); // outside range

    const rows = await listMetricRollupsForRange(db, '2026-07-10', '2026-07-16');
    expect(rows.map((r) => r.date)).toEqual(['2026-07-10', '2026-07-14', '2026-07-16']);
    expect(rows.map((r) => r.value)).toEqual([100, 120, 150]);
  });

  it('includes both range endpoints (inclusive)', async () => {
    await replaceMetricRollupsForDate(db, '2026-07-10', [{ metric: 'dau', value: 1 }]);
    await replaceMetricRollupsForDate(db, '2026-07-16', [{ metric: 'dau', value: 2 }]);

    const rows = await listMetricRollupsForRange(db, '2026-07-10', '2026-07-16');
    expect(rows).toHaveLength(2);
  });

  it('returns multiple dims rows for the same metric/date', async () => {
    await replaceMetricRollupsForDate(db, '2026-07-16', [
      { metric: 'ghost_claim_conversion', value: 0.5, dims: { trigger: 'streak_reminder' } },
      { metric: 'ghost_claim_conversion', value: 0.8, dims: { trigger: 'reveal_wall' } },
    ]);

    const rows = await listMetricRollupsForRange(db, '2026-07-16', '2026-07-16');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dims)).toEqual(
      expect.arrayContaining([{ trigger: 'streak_reminder' }, { trigger: 'reveal_wall' }]),
    );
  });
});
