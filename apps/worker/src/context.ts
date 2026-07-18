/**
 * Shared job context: db handle + boss reference + clock. Time always flows through
 * core/clock now() (§17.2).
 */
import type PgBoss from 'pg-boss';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Db } from '@receipts/db';

export interface JobContext {
  db: Db;
  pool: pg.Pool;
  boss: PgBoss;
  /** Price cache + `venue_degraded` flag (§7.5, WS1-T4). */
  redis: Redis;
}
