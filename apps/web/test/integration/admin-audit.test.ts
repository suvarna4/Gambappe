/**
 * WS10-T1 integration: the "every admin mutation writes audit_log" invariant (§15.1),
 * tested against `withAdminAudit` directly with synthetic handlers — this is the shared
 * wrapper future admin mutation tasks (WS10-T2/T3/T4) must use; there are no real admin
 * mutation routes yet to exercise end-to-end.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, listAuditLog, type Db } from '@receipts/db';
import { withAdminAudit } from '../../lib/admin-audit';

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
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

describe('withAdminAudit (§15.1, §5.6)', () => {
  it('records an audit_log row after a successful mutation', async () => {
    const wrapped = withAdminAudit(
      db,
      'test.mutate',
      () => 'question:abc123',
      async () => new Response(null, { status: 200 }),
    );
    await wrapped(new Request('http://localhost/api/admin/x', { method: 'POST' }));

    const rows = await listAuditLog(db, 1);
    expect(rows[0]?.action).toBe('test.mutate');
    expect(rows[0]?.target).toBe('question:abc123');
    expect(rows[0]?.actorUserId).toBeNull(); // P0 stopgap has no per-admin identity
    expect(rows[0]?.detail).toMatchObject({ method: 'POST', status: 200 });
  });

  it('does not record anything when the handler returns a non-ok response', async () => {
    const before = (await listAuditLog(db, 1))[0]?.id;
    const wrapped = withAdminAudit(
      db,
      'test.failed-mutate',
      () => 'question:xyz',
      async () => new Response(null, { status: 404 }),
    );
    await wrapped(new Request('http://localhost/api/admin/x', { method: 'POST' }));

    const after = (await listAuditLog(db, 1))[0]?.id;
    expect(after).toBe(before); // no new row
  });

  it('does not record anything when the handler throws', async () => {
    const before = (await listAuditLog(db, 1))[0]?.id;
    const wrapped = withAdminAudit(
      db,
      'test.throws',
      () => 'question:err',
      async () => {
        throw new Error('boom');
      },
    );
    await expect(
      wrapped(new Request('http://localhost/api/admin/x', { method: 'POST' })),
    ).rejects.toThrow('boom');

    const after = (await listAuditLog(db, 1))[0]?.id;
    expect(after).toBe(before); // no new row
  });
});
