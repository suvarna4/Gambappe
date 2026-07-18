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
import { markets, picks, posts, profiles, questions, users, verificationTokens } from '../../src/schema/index.js';
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
});
