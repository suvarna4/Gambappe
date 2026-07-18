/**
 * WS11-T4 integration: `findDuplicateAccountByEmail` against real Postgres (§14.4).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { users } from '../../src/schema/index.js';
import { findDuplicateAccountByEmail } from '../../src/repositories/duplicate-accounts.js';

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
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

describe('findDuplicateAccountByEmail (§14.4)', () => {
  it('finds an existing account whose email is a dot/plus variant of the candidate', async () => {
    const existingId = uuidv7();
    await db.insert(users).values({ id: existingId, email: 'a.b@gmail.com' });

    const match = await findDuplicateAccountByEmail(db, 'ab+newsignup@gmail.com');
    expect(match).toEqual({ userId: existingId, email: 'a.b@gmail.com' });
  });

  it('returns null when no existing account matches', async () => {
    await db.insert(users).values({ id: uuidv7(), email: 'someone-else@gmail.com' });
    const match = await findDuplicateAccountByEmail(db, 'ab@gmail.com');
    expect(match).toBeNull();
  });

  it('does not false-positive across different non-Gmail domains with dotted locals', async () => {
    await db.insert(users).values({ id: uuidv7(), email: 'a.b@example.com' });
    const match = await findDuplicateAccountByEmail(db, 'ab@example.com'); // dots matter here
    expect(match).toBeNull();
  });

  it('ignores users with a null email (not yet completed signup)', async () => {
    await db.insert(users).values({ id: uuidv7(), email: null });
    const match = await findDuplicateAccountByEmail(db, 'ab@gmail.com');
    expect(match).toBeNull();
  });
});
