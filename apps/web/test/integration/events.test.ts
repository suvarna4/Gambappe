/**
 * WS13-T1 integration: POST /api/v1/events end-to-end against real Postgres + Redis.
 * Requires a live Postgres and Redis (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { connect, type Db } from '@receipts/db';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;

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

  redis = new Redis(redisUrl);
  await redis.flushdb();

  // The route module reads its Postgres pool / Redis client from apps/web/lib/stores via
  // module-level globalThis caching, keyed off DATABASE_URL/REDIS_URL — point it at the
  // same test instances this suite just migrated/flushed.
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

async function post(body: unknown): Promise<{ status: number; json: unknown }> {
  const { POST } = await import('../../app/api/v1/events/route.js');
  const request = new Request('http://localhost/api/v1/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.42',
      'user-agent': 'integration-test-agent/1.0',
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return { status: response.status, json: await response.json() };
}

async function latestEventRow(event: string) {
  const res = await db.execute(
    sql`SELECT * FROM analytics_events WHERE event = ${event} ORDER BY ts DESC LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

async function countRows(): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM analytics_events`);
  return Number(res.rows[0]!['n']);
}

describe('POST /api/v1/events (§13.1, §9.2)', () => {
  it('accepts a known event and stores it with hashed IP/UA, never the raw values', async () => {
    const { status, json } = await post({ event: 'spectator_view', props: { path: '/q/today' } });
    expect(status).toBe(202);
    expect(json).toEqual({ data: { accepted: true } });

    const row = await latestEventRow('spectator_view');
    expect(row).not.toBeNull();
    expect(row!['props']).toEqual({ path: '/q/today' });
    expect(row!['ip_hash']).toBeTruthy();
    expect(row!['ip_hash']).not.toContain('203.0.113.42');
    expect(row!['ua_hash']).toBeTruthy();
    expect(row!['ua_hash']).not.toContain('integration-test-agent');
    // Assert no raw IP/UA anywhere in the row's serialized form (INV-adjacent §5.6 guarantee).
    expect(JSON.stringify(row)).not.toContain('203.0.113.42');
    expect(JSON.stringify(row)).not.toContain('integration-test-agent');
  });

  it('drops an unknown event silently — still 202, nothing stored', async () => {
    const before = await countRows();
    const { status, json } = await post({ event: 'totally_made_up_event', props: {} });
    expect(status).toBe(202);
    expect(json).toEqual({ data: { accepted: true } });
    expect(await countRows()).toBe(before);
  });

  it('drops the whole event when props exceed EVENT_PROPS_MAX_BYTES — still 202', async () => {
    const before = await countRows();
    const hugeProps = { blob: 'x'.repeat(4096) }; // well past the 2048-byte cap
    const { status } = await post({ event: 'spectator_view', props: hugeProps });
    expect(status).toBe(202);
    expect(await countRows()).toBe(before);
  });

  it('ignores a malformed anon_id rather than rejecting the request', async () => {
    const { status } = await post({
      event: 'ghost_minted',
      props: {},
      anon_id: 'not-a-real-uuid',
    });
    expect(status).toBe(202);
    const row = await latestEventRow('ghost_minted');
    expect(row!['anon_id']).toBeNull();
  });

  it('stores a well-formed anon_id', async () => {
    const anonId = '123e4567-e89b-42d3-a456-426614174000';
    await post({ event: 'ghost_minted', props: {}, anon_id: anonId });
    const row = await latestEventRow('ghost_minted');
    expect(row!['anon_id']).toBe(anonId);
  });

  it('rejects a structurally invalid body (400, not silently dropped)', async () => {
    const { status, json } = await post({ props: {} }); // missing required `event`
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
