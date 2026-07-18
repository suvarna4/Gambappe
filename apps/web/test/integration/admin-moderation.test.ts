/**
 * WS10-T4 integration: the reports queue, bot-flag review list, and auto-pause review list
 * (§15.4) against real Postgres. Report/block *creation* and the auto-pause rule itself are
 * WS11-T3 scope (§14.3, now merged) — fixtures here still insert report rows directly since
 * this suite only exercises the admin read/resolve surface, not report submission.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, insertProfile, listAuditLog, posts, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';

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
  process.env.DATABASE_URL = dbUrl;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE reports, posts, profiles RESTART IDENTITY CASCADE`);
});

function patchRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function insertReport(overrides: {
  reporterProfileId: string;
  reportedProfileId?: string | null;
  contextKind: 'post' | 'pairing' | 'duo' | 'profile';
  contextId: string;
  status?: 'open' | 'actioned' | 'dismissed';
  createdAt?: Date;
}) {
  const res = await db.execute(sql`
    INSERT INTO reports (id, reporter_profile_id, reported_profile_id, context_kind, context_id, reason, note, status, created_at)
    VALUES (
      ${uuidv7()}::uuid, ${overrides.reporterProfileId}::uuid, ${overrides.reportedProfileId ?? null}::uuid,
      ${overrides.contextKind}, ${overrides.contextId}::uuid, 'spam', 'test note',
      ${overrides.status ?? 'open'}, ${(overrides.createdAt ?? new Date()).toISOString()}::timestamptz
    )
    RETURNING id
  `);
  return res.rows[0]!['id'] as string;
}

describe('GET /api/admin/reports (§15.4)', () => {
  it('lists only open reports, oldest first', async () => {
    const { GET } = await import('../../app/api/admin/reports/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const older = await insertReport({
      reporterProfileId: reporter.id, contextKind: 'profile', contextId: reporter.id,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    await insertReport({
      reporterProfileId: reporter.id, contextKind: 'profile', contextId: reporter.id,
      createdAt: new Date('2026-07-02T00:00:00Z'),
    });
    await insertReport({
      reporterProfileId: reporter.id, contextKind: 'profile', contextId: reporter.id, status: 'dismissed',
    });

    const res = await GET();
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.id).toBe(older);
  });
});

describe('PATCH /api/admin/reports/:id resolve actions (§15.4)', () => {
  it('dismiss marks the report dismissed and audits', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const reportId = await insertReport({ reporterProfileId: reporter.id, contextKind: 'profile', contextId: reporter.id });

    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'dismiss' }));
    const body = (await res.json()) as { data: { status: string } };
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('dismissed');

    const audit = await listAuditLog(db, 1);
    expect(audit[0]?.action).toBe('report.resolve');
  });

  it('remove_content marks the post removed_by_mod', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const author = await insertProfile(db, buildProfile());
    const postId = uuidv7();
    await db.insert(posts).values({
      id: postId, contextKind: 'pairing', contextId: uuidv7(), profileId: author.id, body: 'spam body',
    });
    const reportId = await insertReport({ reporterProfileId: reporter.id, contextKind: 'post', contextId: postId });

    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'remove_content' }));
    expect(res.status).toBe(200);

    const [post] = await db.execute(sql`SELECT status FROM posts WHERE id = ${postId}::uuid`).then((r) => r.rows);
    expect(post!['status']).toBe('removed_by_mod');
  });

  it('rejects remove_content when the report context is not a post', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const reportId = await insertReport({ reporterProfileId: reporter.id, contextKind: 'profile', contextId: reporter.id });

    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'remove_content' }));
    const body = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('pause sets the reported profile to paused_matchmaking', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const reported = await insertProfile(db, buildProfile());
    const reportId = await insertReport({
      reporterProfileId: reporter.id, reportedProfileId: reported.id, contextKind: 'profile', contextId: reported.id,
    });

    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'pause' }));
    expect(res.status).toBe(200);

    const [row] = await db.execute(sql`SELECT status FROM profiles WHERE id = ${reported.id}::uuid`).then((r) => r.rows);
    expect(row!['status']).toBe('paused_matchmaking');
  });

  it('suspend sets the reported profile to suspended', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const reported = await insertProfile(db, buildProfile());
    const reportId = await insertReport({
      reporterProfileId: reporter.id, reportedProfileId: reported.id, contextKind: 'profile', contextId: reported.id,
    });

    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'suspend' }));
    expect(res.status).toBe(200);

    const [row] = await db.execute(sql`SELECT status FROM profiles WHERE id = ${reported.id}::uuid`).then((r) => r.rows);
    expect(row!['status']).toBe('suspended');
  });

  it('rejects pause/suspend when the report names no reported profile', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const reportId = await insertReport({ reporterProfileId: reporter.id, contextKind: 'pairing', contextId: uuidv7() });

    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'pause' }));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown report id', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const missingId = '00000000-0000-0000-0000-000000000000';
    const res = await PATCH(patchRequest(`http://localhost/api/admin/reports/${missingId}`, { action: 'dismiss' }));
    expect(res.status).toBe(404);
  });

  it('409s with REPORT_ALREADY_RESOLVED for a second resolve attempt', async () => {
    const { PATCH } = await import('../../app/api/admin/reports/[id]/route.js');
    const reporter = await insertProfile(db, buildProfile());
    const reportId = await insertReport({ reporterProfileId: reporter.id, contextKind: 'profile', contextId: reporter.id });

    const first = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'dismiss' }));
    expect(first.status).toBe(200);

    const second = await PATCH(patchRequest(`http://localhost/api/admin/reports/${reportId}`, { action: 'dismiss' }));
    const body = (await second.json()) as { error: { code: string } };
    expect(second.status).toBe(409);
    expect(body.error.code).toBe('REPORT_ALREADY_RESOLVED');
  });
});

describe('GET /api/admin/bot-flags (§14.2, §15.4)', () => {
  it('lists only profiles at or above the bot-exclude threshold, highest first', async () => {
    const { GET } = await import('../../app/api/admin/bot-flags/route.js');
    const bot1 = await insertProfile(db, buildProfile({ botScore: 0.95 }));
    const bot2 = await insertProfile(db, buildProfile({ botScore: 0.81 }));
    await insertProfile(db, buildProfile({ botScore: 0.3 })); // below threshold

    const res = await GET();
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((p) => p.id)).toEqual([bot1.id, bot2.id]);
  });
});

describe('GET+PATCH /api/admin/auto-pause (§14.3, §15.4)', () => {
  it('lists only paused_matchmaking profiles', async () => {
    const { GET } = await import('../../app/api/admin/auto-pause/route.js');
    const paused = await insertProfile(db, buildProfile({ status: 'paused_matchmaking' }));
    await insertProfile(db, buildProfile({ status: 'active' }));

    const res = await GET();
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((p) => p.id)).toEqual([paused.id]);
  });

  it('restore sets the profile active and audits', async () => {
    const { PATCH } = await import('../../app/api/admin/auto-pause/[id]/route.js');
    const paused = await insertProfile(db, buildProfile({ status: 'paused_matchmaking' }));

    const res = await PATCH(patchRequest(`http://localhost/api/admin/auto-pause/${paused.id}`, { action: 'restore' }));
    const body = (await res.json()) as { data: { status: string } };
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('active');

    const audit = await listAuditLog(db, 1);
    expect(audit[0]?.action).toBe('profile.auto_pause_resolve');
  });

  it('suspend sets the profile suspended', async () => {
    const { PATCH } = await import('../../app/api/admin/auto-pause/[id]/route.js');
    const paused = await insertProfile(db, buildProfile({ status: 'paused_matchmaking' }));

    const res = await PATCH(patchRequest(`http://localhost/api/admin/auto-pause/${paused.id}`, { action: 'suspend' }));
    const body = (await res.json()) as { data: { status: string } };
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('suspended');
  });

  it('rejects resolving a profile that is not pending auto-pause review', async () => {
    const { PATCH } = await import('../../app/api/admin/auto-pause/[id]/route.js');
    const active = await insertProfile(db, buildProfile({ status: 'active' }));

    const res = await PATCH(patchRequest(`http://localhost/api/admin/auto-pause/${active.id}`, { action: 'restore' }));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown profile id', async () => {
    const { PATCH } = await import('../../app/api/admin/auto-pause/[id]/route.js');
    const missingId = '00000000-0000-0000-0000-000000000000';
    const res = await PATCH(patchRequest(`http://localhost/api/admin/auto-pause/${missingId}`, { action: 'restore' }));
    expect(res.status).toBe(404);
  });
});
