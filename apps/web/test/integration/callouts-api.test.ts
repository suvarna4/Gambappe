/**
 * WS20-T3 (journeys plan §5, D-J5) integration: the call-out server loop, exercising
 * `@/lib/callouts` directly against a real Postgres. Route auth (Auth.js session resolution) isn't
 * mockable in vitest — see `nemesis-rematch-api.test.ts`'s header — so the route files are thin
 * parse → authorize → delegate shims over these functions, and the lib is the tested seam. The
 * ghost→401 `save_required` and flag-off→404 behaviours live in the route shims and are covered by
 * the CI e2e suite (WS23-T1), not here.
 *
 * Covers: create (SHA-256 hash stored, raw token only in `share_url`, never at rest), preview
 * (spectator-safe fields, expired→410 reason, missing→404 reason), accept (mints the next-week
 * pairing, idempotent second accept, self-challenge, unknown token), decline.
 *
 * Connects via TEST_DATABASE_URL (dedicated per-agent DB; CI default receipts_test).
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setTestClock } from '@receipts/core';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import {
  callouts,
  connect,
  nemesisPairings,
  profiles,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import {
  acceptCalloutForOpponent,
  createCalloutForChallenger,
  declineCalloutForActor,
  getCalloutPreview,
  hashCalloutToken,
} from '@/lib/callouts';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

// A Sunday (ISO week Mon 2026-07-13) — accept resolves the pairing into the next-week Monday
// window, 2026-07-20.
const AT = new Date('2026-07-19T18:00:00Z');

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL ??= 'https://gambappe.example';
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

beforeEach(async () => {
  // Freeze `now()` at AT so the repo-side expiry checks (`acceptCallout`/`declineCallout` read
  // `now()`, not the passed `at`) line up with the 24h expiry the lib stamps from AT.
  setTestClock(AT);
  await db.execute(
    sql`TRUNCATE TABLE callouts, nemesis_pairings, seasons, profiles RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => setTestClock(null));

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const [row] = await db
    .insert(profiles)
    .values(buildProfile({ kind: 'claimed', status: 'active', ...overrides }))
    .returning();
  return row!;
}

/** Pull the raw `?callout=` token back out of a create response's share_url. */
function tokenFromShareUrl(shareUrl: string): string {
  return new URL(shareUrl).searchParams.get('callout')!;
}

describe('createCalloutForChallenger (POST /api/v1/callouts)', () => {
  it('stores only the SHA-256 of the token; the raw token rides share_url only', async () => {
    const challenger = await makeClaimedProfile();
    const res = await createCalloutForChallenger(db, challenger, AT);

    expect(res.share_url).toMatch(/^https:\/\/gambappe\.example\/rivals\?callout=/);
    const rawToken = tokenFromShareUrl(res.share_url);

    const [row] = await db.select().from(callouts);
    // The stored hash matches SHA-256(rawToken); the raw token appears nowhere at rest.
    expect(row!.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(row!.tokenHash).toBe(hashCalloutToken(rawToken));
    expect(row!.tokenHash).not.toBe(rawToken);

    expect(res.callout.status).toBe('pending');
    expect(res.callout.challenger.profile_id).toBe(challenger.id);
    expect(res.callout.opponent).toBeNull();
    expect(res.callout.pairing_id).toBeNull();
    // 24h expiry from `AT`.
    expect(new Date(res.callout.expires_at).getTime()).toBe(AT.getTime() + 24 * 3600_000);
  });
});

describe('getCalloutPreview (GET /api/v1/callouts/:token)', () => {
  it('returns spectator-safe fields (challenger, status, expiry) and no opponent/internal ids', async () => {
    const challenger = await makeClaimedProfile();
    const { share_url } = await createCalloutForChallenger(db, challenger, AT);
    const token = tokenFromShareUrl(share_url);

    const result = await getCalloutPreview(db, token, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.status).toBe('pending');
    expect(result.preview.challenger).toEqual({
      profile_id: challenger.id,
      handle: challenger.handle,
      slug: challenger.slug,
    });
    // Spectator-safe shape: exactly status/challenger/expires_at — no opponent, no callout id.
    expect(Object.keys(result.preview).sort()).toEqual(['challenger', 'expires_at', 'status']);
  });

  it('reports expired for a past-expiry token (→410) and not_found for a miss (→404)', async () => {
    const challenger = await makeClaimedProfile();
    const { share_url } = await createCalloutForChallenger(db, challenger, AT);
    const token = tokenFromShareUrl(share_url);

    // 25h later — past the 24h expiry.
    const later = new Date(AT.getTime() + 25 * 3600_000);
    expect(await getCalloutPreview(db, token, later)).toEqual({ ok: false, reason: 'expired' });
    // A GET performs no write — the row is still `pending`, not lazily flipped.
    expect((await db.select().from(callouts))[0]!.status).toBe('pending');

    expect(await getCalloutPreview(db, 'not-a-real-token', AT)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('acceptCalloutForOpponent (POST /api/v1/callouts/:token/accept)', () => {
  it('mints the next-week pairing and populates opponent/pairing_id', async () => {
    const challenger = await makeClaimedProfile();
    const opponent = await makeClaimedProfile();
    const { share_url } = await createCalloutForChallenger(db, challenger, AT);
    const token = tokenFromShareUrl(share_url);

    const result = await acceptCalloutForOpponent(db, token, opponent, AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.callout.status).toBe('accepted');
    expect(result.response.callout.opponent?.profile_id).toBe(opponent.id);
    expect(result.response.callout.pairing_id).toBeTruthy();

    const [pairing] = await db.select().from(nemesisPairings);
    // AT is Sun 2026-07-19 (ISO week Mon 2026-07-13); the next-week Monday is 2026-07-20.
    expect(pairing!.weekStart).toBe('2026-07-20');
    expect(pairing!.status).toBe('scheduled');
    const [lo, hi] = [challenger.id, opponent.id].sort();
    expect(pairing!.profileAId).toBe(lo);
    expect(pairing!.profileBId).toBe(hi);

    // The accept auto-created the covering nemesis season.
    expect((await db.select().from(seasons)).length).toBe(1);
  });

  it('is idempotent: a second accept returns already_resolved and mints no second pairing', async () => {
    const challenger = await makeClaimedProfile();
    const opponent = await makeClaimedProfile();
    const { share_url } = await createCalloutForChallenger(db, challenger, AT);
    const token = tokenFromShareUrl(share_url);

    expect((await acceptCalloutForOpponent(db, token, opponent, AT)).ok).toBe(true);
    expect(await acceptCalloutForOpponent(db, token, opponent, AT)).toEqual({
      ok: false,
      reason: 'already_resolved',
    });
    expect(await db.select().from(nemesisPairings)).toHaveLength(1);
  });

  it('rejects a self-challenge and an unknown token', async () => {
    const challenger = await makeClaimedProfile();
    const { share_url } = await createCalloutForChallenger(db, challenger, AT);
    const token = tokenFromShareUrl(share_url);

    expect(await acceptCalloutForOpponent(db, token, challenger, AT)).toEqual({
      ok: false,
      reason: 'self_challenge',
    });
    expect(await acceptCalloutForOpponent(db, 'missing-token', challenger, AT)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('declineCalloutForActor (POST /api/v1/callouts/:token/decline)', () => {
  it('flips the callout to declined and creates no pairing', async () => {
    const challenger = await makeClaimedProfile();
    const { share_url } = await createCalloutForChallenger(db, challenger, AT);
    const token = tokenFromShareUrl(share_url);

    const result = await declineCalloutForActor(db, token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.callout.status).toBe('declined');
    expect(result.response.callout.opponent).toBeNull();
    expect(await db.select().from(nemesisPairings)).toHaveLength(0);

    // Idempotent/terminal-safe.
    expect(await declineCalloutForActor(db, token)).toEqual({ ok: false, reason: 'already_resolved' });
  });
});
