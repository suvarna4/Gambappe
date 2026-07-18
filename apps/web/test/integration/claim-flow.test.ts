/**
 * WS2-T3 integration: `runClaim` (§6.3) against a real Postgres — table-driven cases A–D, the
 * "This isn't me" shared-device guard (clears cookie, runs case B), the INV-9 attestation
 * gate, and merge dedupe delegating to `mergeGhostIntoProfile` (covered in depth by
 * `packages/db/test/integration/merge.test.ts`; here we just assert the case label + effects).
 * Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, getProfileById, profiles, users, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { runClaim } from '@/lib/claim-flow';
import { buildGhostCookieValue, generateGhostSecret, hashGhostSecret } from '@/lib/ghost-cookie';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.GHOST_COOKIE_SECRET = 'integration-test-ghost-cookie-secret';
  ({ pool, db } = connect({ connectionString: url }));
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

async function makeAttestedUser(): Promise<string> {
  const id = uuidv7();
  await db.insert(users).values({ id, email: `${id}@example.com`, ageAttestedAt: new Date('2026-01-01T00:00:00Z') });
  return id;
}

async function makeUnattestedUser(): Promise<string> {
  const id = uuidv7();
  await db.insert(users).values({ id, email: `${id}@example.com` });
  return id;
}

async function makeGhostCookie(): Promise<{ ghostId: string; cookieValue: string }> {
  const secret = generateGhostSecret();
  const ghost = buildProfile({ ghostSecretHash: hashGhostSecret(secret) });
  await db.insert(profiles).values(ghost);
  return { ghostId: ghost.id as string, cookieValue: buildGhostCookieValue(ghost.id as string, secret) };
}

describe('runClaim (§6.3 cases A-D)', () => {
  it('AGE_ATTESTATION_REQUIRED when users.age_attested_at is null and age_attested is not sent', async () => {
    const userId = await makeUnattestedUser();
    await expect(runClaim(db, { userId, ghostCookieValue: null })).rejects.toMatchObject({
      code: 'AGE_ATTESTATION_REQUIRED',
    });
  });

  it('accepts age_attested:true, stamps users.age_attested_at, and proceeds (case B)', async () => {
    const userId = await makeUnattestedUser();
    const result = await runClaim(db, { userId, ghostCookieValue: null, ageAttested: true });
    expect(result.case).toBe('B');
    const [userRow] = await db.select().from(users).where(eq(users.id, userId));
    expect(userRow!.ageAttestedAt).not.toBeNull();
  });

  it('case B: no existing profile, no ghost cookie → fresh claimed profile with a generated handle', async () => {
    const userId = await makeAttestedUser();
    const result = await runClaim(db, { userId, ghostCookieValue: null });
    expect(result.case).toBe('B');
    expect(result.profile.kind).toBe('claimed');
    expect(result.profile.userId).toBe(userId);
    expect(result.profile.handleIsGenerated).toBe(true);
    expect(result.clearGhostCookie).toBe(false);
  });

  it('case A: no existing profile, valid ghost cookie → transitions the ghost row in place', async () => {
    const userId = await makeAttestedUser();
    const { ghostId, cookieValue } = await makeGhostCookie();
    const result = await runClaim(db, { userId, ghostCookieValue: cookieValue });
    expect(result.case).toBe('A');
    expect(result.profile.id).toBe(ghostId); // same row, transitioned
    expect(result.profile.kind).toBe('claimed');
    expect(result.profile.userId).toBe(userId);
    expect(result.profile.ghostSecretHash).toBeNull();
    expect(result.clearGhostCookie).toBe(true);
  });

  it('case D: existing profile, no cookie → no-op', async () => {
    const userId = await makeAttestedUser();
    const first = await runClaim(db, { userId, ghostCookieValue: null });
    const second = await runClaim(db, { userId, ghostCookieValue: null });
    expect(second.case).toBe('D');
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.clearGhostCookie).toBe(false);
  });

  it('case C: existing profile, valid ghost cookie → merges G into P and clears the cookie', async () => {
    const userId = await makeAttestedUser();
    const first = await runClaim(db, { userId, ghostCookieValue: null }); // case B, creates P
    const { ghostId, cookieValue } = await makeGhostCookie();
    const result = await runClaim(db, { userId, ghostCookieValue: cookieValue });
    expect(result.case).toBe('C');
    expect(result.profile.id).toBe(first.profile.id);
    expect(result.clearGhostCookie).toBe(true);
    const ghostAfter = await getProfileById(db, ghostId);
    expect(ghostAfter!.status).toBe('deleted');
    expect(ghostAfter!.mergedIntoProfileId).toBe(first.profile.id);
  });

  it('"This isn\'t me": not_me clears the cookie and runs case B/D instead of A/C', async () => {
    const userId = await makeAttestedUser();
    const { ghostId, cookieValue } = await makeGhostCookie();
    const result = await runClaim(db, { userId, ghostCookieValue: cookieValue, notMe: true });
    expect(result.case).toBe('B'); // not A, even though a valid cookie was presented
    expect(result.clearGhostCookie).toBe(true);
    // The disclaimed ghost is untouched — not merged/transitioned.
    const ghostAfter = await getProfileById(db, ghostId);
    expect(ghostAfter!.kind).toBe('ghost');
    expect(ghostAfter!.status).toBe('active');
  });

  it('an invalid/stale ghost cookie never errors — resolves as if absent, and is cleared', async () => {
    const userId = await makeAttestedUser();
    const bogusCookie = `${uuidv7()}.not-a-real-secret`;
    const result = await runClaim(db, { userId, ghostCookieValue: bogusCookie });
    expect(result.case).toBe('B');
    expect(result.clearGhostCookie).toBe(true);
  });
});
