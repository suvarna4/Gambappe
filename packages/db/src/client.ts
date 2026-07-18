/**
 * DB client construction (node-postgres + drizzle). Prod web traffic goes through pooled
 * connections (Neon pooler / pgBouncer, §10.2); locally this is a plain pg Pool.
 */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

export interface CreateDbOptions {
  connectionString?: string;
  max?: number;
}

export function createPool(options: CreateDbOptions = {}): pg.Pool {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (see .env.example)');
  }
  return new pg.Pool({ connectionString, max: options.max ?? 10 });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

/** Convenience for scripts/workers: pool + db in one call. */
export function connect(options: CreateDbOptions = {}): { pool: pg.Pool; db: Db } {
  const pool = createPool(options);
  return { pool, db: createDb(pool) };
}
