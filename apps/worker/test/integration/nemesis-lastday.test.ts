/**
 * WS9-T3 integration: `nemesis:lastday` (§7.6, Sun 09:00 ET) against a real Postgres. WS5
 * hasn't landed on this branch, so this only proves the mock-start no-op contract: with no
 * `nemesis_pairings` rows, it does nothing (idempotent, heartbeat-writing via the registry
 * wrapper); with an `active` pairing present (schema exists from WS0-T3, nothing populates it
 * yet in production either), it still fires zero beats today — see the SPEC-GAP in
 * `nemesis-lastday.ts`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, nemesisPairings, notifications, profiles, seasons, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { runNemesisLastday } from '../../src/jobs/nemesis-lastday.js';

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

describe('nemesis:lastday (WS9-T3, §7.6 mock-start)', () => {
  it('is a correct no-op with no pairings', async () => {
    const report = await runNemesisLastday(db, new Date('2026-07-19T13:00:00Z'));
    expect(report).toEqual({ activePairings: 0, beatsWritten: 0 });
  });

  it('finds active pairings but fires no beats yet (SPEC-GAP: WS5 scoring not implemented)', async () => {
    const [a, b] = [buildProfile(), buildProfile()];
    await db.insert(profiles).values([a, b]);
    const season = { id: uuidv7(), kind: 'nemesis' as const, startsOn: '2026-07-13', endsOn: '2026-10-04', name: 'Test season' };
    await db.insert(seasons).values(season);
    await db.insert(nemesisPairings).values({
      id: uuidv7(),
      seasonId: season.id,
      weekStart: '2026-07-13',
      profileAId: a.id as string,
      profileBId: b.id as string,
      status: 'active',
    });

    const report = await runNemesisLastday(db, new Date('2026-07-19T13:00:00Z'));
    expect(report).toEqual({ activePairings: 1, beatsWritten: 0 });

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(0);
  });
});
