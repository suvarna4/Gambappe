/**
 * WS2-T5 integration: `deleteAccount` (§11.4) against a real Postgres. AC: old slug 404s
 * (via `getProfileBySlug` returning null), picks `is_public=false` (rows retained, aggregate
 * counts unchanged), email gone from `users` (hard delete), posts `removed_by_author`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { deleteAccount } from '../../src/repositories/account-deletion.js';
import { getProfileBySlug } from '../../src/repositories/profiles.js';
import {
  analyticsEvents,
  markets,
  picks,
  posts,
  profiles,
  questions,
  users,
  verificationTokens,
} from '../../src/schema/index.js';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '../../src/testing/index.js';

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

describe('deleteAccount (§11.4)', () => {
  it('soft-deletes the profile, hides picks, hard-deletes the user, leaves aggregates untouched', async () => {
    const userId = uuidv7();
    await db.insert(users).values({ id: userId, email: 'delete-me@example.com' });

    const profile = buildProfile({ kind: 'claimed', userId, ghostSecretHash: null });
    const oldSlug = profile.slug as string;
    await db.insert(profiles).values(profile);

    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, {
      status: 'revealed',
      yesCount: 5,
      noCount: 3,
    });
    await db.insert(questions).values(question);
    await db.insert(picks).values(buildPick(question.id as string, profile.id as string, { side: 'yes', result: 'win' }));

    await db.insert(posts).values({
      id: uuidv7(),
      contextKind: 'question',
      contextId: question.id as string,
      profileId: profile.id as string,
      body: 'hello',
      status: 'visible',
    });

    // A pending magic-link send — verification_tokens has no FK to users (Auth.js keys it by
    // email), so the users hard-delete's cascade can't reach it on its own.
    await db.insert(verificationTokens).values({
      identifier: 'delete-me@example.com',
      token: 'pending-magic-link-token',
      expires: new Date('2026-07-19T00:15:00Z'),
    });

    await deleteAccount(db, profile.id as string, userId, new Date('2026-07-19T00:00:00Z'));

    // Old slug 404s.
    expect(await getProfileBySlug(db, oldSlug)).toBeNull();

    // New slug/handle is the collision-proof `deleted-{full uuid}` form.
    const [row] = await db.select().from(profiles).where(eq(profiles.id, profile.id as string));
    expect(row!.status).toBe('deleted');
    expect(row!.handle).toBe(`deleted-${profile.id}`);
    expect(row!.slug).toBe(`deleted-${profile.id}`);

    // Picks retained but hidden; aggregate counts (question yes/no counts) untouched.
    const [pickRow] = await db.select().from(picks).where(eq(picks.profileId, profile.id as string));
    expect(pickRow).toBeDefined();
    expect(pickRow!.isPublic).toBe(false);
    const [questionAfter] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(questionAfter!.yesCount).toBe(5);
    expect(questionAfter!.noCount).toBe(3);

    // Posts removed_by_author, body retained.
    const [postRow] = await db.select().from(posts).where(eq(posts.profileId, profile.id as string));
    expect(postRow!.status).toBe('removed_by_author');
    expect(postRow!.body).toBe('hello');

    // Email gone from `users` (hard delete).
    const userRows = await db.execute(sql`SELECT email FROM users WHERE id = ${userId}`);
    expect(userRows.rows).toHaveLength(0);

    // Pending verification_tokens for that email are pruned too — not just the users row.
    const tokenRows = await db
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, 'delete-me@example.com'));
    expect(tokenRows).toHaveLength(0);
  });

  it('scrubs analytics_events (profile_id/ip_hash/ua_hash nulled, rows retained) — §11.4, audit 3.2', async () => {
    const userId = uuidv7();
    await db.insert(users).values({ id: userId, email: `scrub-${userId}@example.com` });
    const profile = buildProfile({ kind: 'claimed', userId, ghostSecretHash: null });
    await db.insert(profiles).values(profile);
    const bystander = buildProfile({ kind: 'ghost' });
    await db.insert(profiles).values(bystander);

    // `ts` must be "now": 0001_init only creates the current + next month's partitions of the
    // RANGE-partitioned table, so a fixed historical date would fail routing.
    const ts = new Date();
    await db.insert(analyticsEvents).values([
      {
        ts,
        event: 'pick_created',
        profileId: profile.id as string,
        isGhost: false,
        props: { marker: 'deleted-1' },
        ipHash: 'ip-hash-deleted',
        uaHash: 'ua-hash-deleted',
      },
      // Second row with hashes already aged out (§5.6's 7-day null) — profile_id must still go.
      { ts, event: 'reveal_attended', profileId: profile.id as string, isGhost: false, props: { marker: 'deleted-2' } },
      {
        ts,
        event: 'pick_created',
        profileId: bystander.id as string,
        isGhost: true,
        props: { marker: 'bystander' },
        ipHash: 'ip-hash-bystander',
        uaHash: 'ua-hash-bystander',
      },
    ]);

    await deleteAccount(db, profile.id as string, userId, new Date('2026-07-19T00:00:00Z'));

    // No behavioral trail survives erasure: nothing references the deleted profile id anymore…
    const stillLinked = await db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.profileId, profile.id as string));
    expect(stillLinked).toHaveLength(0);

    // …but the rows themselves are retained (aggregate metrics stay truthful), fully de-identified.
    const all = await db.select().from(analyticsEvents);
    expect(all).toHaveLength(3);
    const byMarker = new Map(all.map((row) => [(row.props as { marker: string }).marker, row]));
    for (const marker of ['deleted-1', 'deleted-2'] as const) {
      const row = byMarker.get(marker)!;
      expect(row.profileId).toBeNull();
      expect(row.ipHash).toBeNull();
      expect(row.uaHash).toBeNull();
    }
    expect(byMarker.get('deleted-1')!.event).toBe('pick_created'); // event name survives for aggregates

    // The bystander's row is untouched — the scrub is scoped to the deleted profile only.
    const bystanderRow = byMarker.get('bystander')!;
    expect(bystanderRow.profileId).toBe(bystander.id as string);
    expect(bystanderRow.ipHash).toBe('ip-hash-bystander');
    expect(bystanderRow.uaHash).toBe('ua-hash-bystander');
  });
});
