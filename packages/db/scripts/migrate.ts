/**
 * Apply migrations (deploy release step, §18; additive-only policy §4.5).
 * Usage: DATABASE_URL=... pnpm --filter @receipts/db db:migrate
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connect } from '../src/client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

const { pool, db } = connect();
try {
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
} finally {
  await pool.end();
}
