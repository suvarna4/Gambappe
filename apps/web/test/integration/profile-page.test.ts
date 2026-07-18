/**
 * WS7-T4 integration: the public-profile service layer (§9.2 `GET /profiles/:slug(/picks)`)
 * against a real Postgres — response shapes validated against the actual `@receipts/core` zod
 * schemas (not just structurally typed), the §6.5 publication-rule masking of a
 * graded-but-unrevealed daily pick, minute-truncated `picked_at`, cursor pagination across the
 * full pick log, and a `deleted` profile resolving to `null` everywhere (→ 404, WS7-T4 AC).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import {
  connect,
  insertMarket,
  insertPick,
  insertProfile,
  insertQuestion,
  insertWalletLink,
  updateProfileById,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { getProfilePicksResponseSchema, getProfileResponseSchema } from '@receipts/core';
import {
  decodePicksCursor,
  encodePicksCursor,
  getProfilePageModel,
  getProfilePicksResponse,
  getProfilePublicView,
} from '@/lib/profile-page';

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
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE picks, questions, markets, profiles, wallet_links RESTART IDENTITY CASCADE`,
  );
});

describe('getProfilePublicView (§9.2 GET /profiles/:slug)', () => {
  it('null for an unknown slug', async () => {
    expect(await getProfilePublicView(db, 'no-such-profile')).toBeNull();
  });

  it('null for a deleted profile (WS7-T4 AC: deleted profiles 404, not error)', async () => {
    const profile = await insertProfile(db, buildProfile({ status: 'deleted' }));
    expect(await getProfilePublicView(db, profile.slug)).toBeNull();
  });

  it('a fresh profile with no picks/fingerprint/rating parses against the exact contract shape', async () => {
    const profile = await insertProfile(db, buildProfile());
    const view = await getProfilePublicView(db, profile.slug);
    expect(view).not.toBeNull();
    // Throws on any drift from the WS0-T2 contract — the strongest shape guarantee available.
    expect(() => getProfileResponseSchema.parse(view)).not.toThrow();
    expect(view).toMatchObject({
      handle: profile.handle,
      slug: profile.slug,
      fingerprint: null,
      rating: null,
      wallet: null,
      badges: [],
      nemesis_summary: { wins: 0, losses: 0, draws: 0 },
      recent_picks: { data: [], meta: { next_cursor: null } },
    });
  });

  it('masks a graded-but-unrevealed daily pick as pending (§6.5) and truncates picked_at to the minute', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(db, buildQuestion(market.id, { status: 'locked' }));
    await insertPick(
      db,
      buildPick(question.id, profile.id, {
        result: 'win',
        edge: 0.4,
        pickedAt: new Date('2026-01-01T12:34:56.789Z'),
      }),
    );

    const view = await getProfilePublicView(db, profile.slug);
    const pick = view!.recent_picks.data[0]!;
    expect(pick.result).toBe('pending');
    expect(pick.edge).toBeNull();
    expect(pick.picked_at).toBe('2026-01-01T12:34:00.000Z'); // seconds truncated away
  });

  it('shows the real result once the daily is revealed', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { status: 'revealed', revealedAt: new Date() }),
    );
    await insertPick(db, buildPick(question.id, profile.id, { result: 'win', edge: 0.4 }));

    const view = await getProfilePublicView(db, profile.slug);
    expect(view!.recent_picks.data[0]).toMatchObject({ result: 'win', edge: 0.4 });
  });

  it('a bonus question win/loss is never masked, even while "locked" (§8.8.1 — no held reveal)', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { kind: 'nemesis_bonus', questionDate: null, status: 'locked' }),
    );
    await insertPick(db, buildPick(question.id, profile.id, { result: 'loss', edge: -0.6 }));

    const view = await getProfilePublicView(db, profile.slug);
    expect(view!.recent_picks.data[0]).toMatchObject({ result: 'loss', edge: -0.6 });
  });

  it('derives the called_it badge only once the qualifying win is publicly revealed', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(db, buildQuestion(market.id, { status: 'locked' }));
    await insertPick(
      db,
      buildPick(question.id, profile.id, { side: 'yes', yesPriceAtEntry: 0.15, result: 'win' }),
    );

    expect((await getProfilePublicView(db, profile.slug))!.badges).toEqual([]);

    await db.execute(
      sql`UPDATE questions SET status = 'revealed', revealed_at = now() WHERE id = ${question.id}`,
    );
    expect((await getProfilePublicView(db, profile.slug))!.badges).toEqual(['called_it']);
  });

  it('surfaces the WS12 wallet badge (verified + allowlisted stats), hiding the address unless opted in', async () => {
    const profile = await insertProfile(db, buildProfile());
    await insertWalletLink(db, {
      id: uuidv7(),
      profileId: profile.id,
      address: '0xabc123',
      addressHash: 'hash-abc123',
      verifiedAt: new Date(),
      status: 'active',
      enrichment: { trades: 42, firstSeen: '2025-06' },
    });

    const hiddenAddress = await getProfilePublicView(db, profile.slug);
    expect(hiddenAddress!.wallet).toEqual({
      verified: true,
      first_seen: '2025-06',
      position_count: 42,
      address: null, // settings.show_wallet_address defaults false (§9.4)
    });

    await updateProfileById(db, profile.id, { settings: { show_wallet_address: true } });
    const shownAddress = await getProfilePublicView(db, profile.slug);
    expect(shownAddress!.wallet?.address).toBe('0xabc123');
  });
});

describe('getProfilePicksResponse (§9.2 GET /profiles/:slug/picks, cursor pagination §9.1)', () => {
  it('null for a deleted profile', async () => {
    const profile = await insertProfile(db, buildProfile({ status: 'deleted' }));
    expect(await getProfilePicksResponse(db, profile.slug, null, 20)).toBeNull();
  });

  it('pages through the full log newest-first with no gaps or repeats, matching the exact contract shape', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const t0 = new Date('2026-03-01T00:00:00Z').getTime();
    const questionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const q = await insertQuestion(
        db,
        buildQuestion(market.id, {
          status: 'revealed',
          revealedAt: new Date(),
          questionDate: `2026-03-${String(i + 1).padStart(2, '0')}`,
        }),
      );
      await insertPick(
        db,
        buildPick(q.id, profile.id, {
          pickedAt: new Date(t0 + i * 60_000),
          result: 'win',
          edge: 0.1,
        }),
      );
      questionIds.push(q.id);
    }

    const page1 = await getProfilePicksResponse(db, profile.slug, null, 2);
    expect(() => getProfilePicksResponseSchema.parse(page1)).not.toThrow();
    expect(page1!.data.map((p) => p.question_id)).toEqual([questionIds[4], questionIds[3]]);
    expect(page1!.meta.next_cursor).not.toBeNull();

    const page2 = await getProfilePicksResponse(db, profile.slug, page1!.meta.next_cursor, 2);
    expect(page2!.data.map((p) => p.question_id)).toEqual([questionIds[2], questionIds[1]]);

    const page3 = await getProfilePicksResponse(db, profile.slug, page2!.meta.next_cursor, 2);
    expect(page3!.data.map((p) => p.question_id)).toEqual([questionIds[0]]);
    expect(page3!.meta.next_cursor).toBeNull(); // short page — no more rows
  });
});

describe('getProfilePageModel (/p/[slug] rendering data)', () => {
  it('null for a deleted profile', async () => {
    const profile = await insertProfile(db, buildProfile({ status: 'deleted' }));
    expect(await getProfilePageModel(db, profile.slug, null)).toBeNull();
  });

  it('carries the joined question headline/labels the JSON pick log intentionally omits', async () => {
    const profile = await insertProfile(db, buildProfile());
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, {
        headline: 'Will it rain?',
        status: 'revealed',
        revealedAt: new Date(),
      }),
    );
    await insertPick(db, buildPick(question.id, profile.id, { result: 'win', edge: 0.2 }));

    const model = await getProfilePageModel(db, profile.slug, null);
    expect(model!.picks[0]!.question.headline).toBe('Will it rain?');
  });
});

describe('picks cursor codec', () => {
  it('round-trips', () => {
    const encoded = encodePicksCursor({
      pickedAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 'abc-123',
    });
    expect(decodePicksCursor(encoded)).toEqual({
      pickedAt: '2026-01-01T00:00:00.000Z',
      id: 'abc-123',
    });
  });

  it('malformed cursor decodes to null rather than throwing', () => {
    expect(decodePicksCursor('not-base64url-garbage-!!!')).toBeNull();
    expect(decodePicksCursor(undefined)).toBeNull();
    expect(decodePicksCursor(null)).toBeNull();
  });
});
