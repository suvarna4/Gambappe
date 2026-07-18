/**
 * WS7-T8 integration: `apps/web/lib/threads.ts` (posts + reactions orchestration, §9.2, §5.6)
 * against real Postgres. Mirrors `test/integration/moderation.test.ts`'s setup pattern.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, insertMarket, insertQuestion, profiles, type Db } from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion } from '@receipts/db/testing';
import {
  createPost,
  encodeThreadCursor,
  getQuestionThreadPage,
  getThreadPage,
  submitReaction,
  THREAD_DEFAULT_LIMIT,
} from '@/lib/threads';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-20T12:00:00Z');

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
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
    sql`TRUNCATE posts, reactions, nemesis_pairings, ratings, picks, questions, markets, profiles, users, seasons RESTART IDENTITY CASCADE`,
  );
});

async function makeClaimedProfile() {
  const profile = buildProfile({ kind: 'claimed' });
  await db.insert(profiles).values(profile);
  return profile;
}

async function makeQuestion() {
  const market = await insertMarket(db, buildMarket());
  return insertQuestion(db, buildQuestion(market.id, { questionDate: null, status: 'revealed' }));
}

describe('getThreadPage / getQuestionThreadPage (§9.2 GET .../thread)', () => {
  it('returns posts (oldest first) + reaction counts for a context', async () => {
    const question = await makeQuestion();
    const author = await makeClaimedProfile();

    await createPost(
      db,
      { contextKind: 'question', contextId: question.id, author: { profileId: author.id as string, handle: author.handle, slug: author.slug }, body: 'first' },
      new Date(NOW.getTime()),
    );
    await createPost(
      db,
      { contextKind: 'question', contextId: question.id, author: { profileId: author.id as string, handle: author.handle, slug: author.slug }, body: 'second' },
      new Date(NOW.getTime() + 1000),
    );
    await submitReaction(db, { contextKind: 'question', contextId: question.id, profileId: author.id as string, emoji: '🔥' });

    const page = await getThreadPage(db, 'question', question.id, null, THREAD_DEFAULT_LIMIT);
    expect(page.data.posts.map((p) => p.body)).toEqual(['first', 'second']);
    expect(page.data.posts[0]!.author).toEqual({
      profile_id: author.id,
      handle: author.handle,
      slug: author.slug,
    });
    expect(page.data.reaction_counts).toEqual([{ emoji: '🔥', count: 1 }]);
    expect(page.meta.next_cursor).toBeNull();
  });

  it('paginates with a keyset cursor (limit=1 returns a next_cursor, page 2 has the rest)', async () => {
    const question = await makeQuestion();
    const author = await makeClaimedProfile();
    const authorRef = { profileId: author.id as string, handle: author.handle, slug: author.slug };

    await createPost(db, { contextKind: 'question', contextId: question.id, author: authorRef, body: 'a' }, new Date(NOW.getTime()));
    await createPost(db, { contextKind: 'question', contextId: question.id, author: authorRef, body: 'b' }, new Date(NOW.getTime() + 1000));

    const page1 = await getThreadPage(db, 'question', question.id, null, 1);
    expect(page1.data.posts.map((p) => p.body)).toEqual(['a']);
    expect(page1.meta.next_cursor).not.toBeNull();

    const page2 = await getThreadPage(db, 'question', question.id, page1.meta.next_cursor, 1);
    expect(page2.data.posts.map((p) => p.body)).toEqual(['b']);
    // A FULL page always carries a cursor, even if it happens to be the last one (same
    // "assume more, let the next fetch prove otherwise" convention as `profile-page.ts`'s
    // `fetchPicksPage` — it doesn't over-fetch by one to know for certain). The genuinely
    // empty page after it is what actually reports `next_cursor: null`.
    expect(page2.meta.next_cursor).not.toBeNull();

    const page3 = await getThreadPage(db, 'question', question.id, page2.meta.next_cursor, 1);
    expect(page3.data.posts).toEqual([]);
    expect(page3.meta.next_cursor).toBeNull();
  });

  it('getQuestionThreadPage resolves by slug and returns null for an unknown slug', async () => {
    const question = await makeQuestion();
    const page = await getQuestionThreadPage(db, question.slug!, null, THREAD_DEFAULT_LIMIT);
    expect(page).not.toBeNull();

    const missing = await getQuestionThreadPage(db, 'no-such-slug', null, THREAD_DEFAULT_LIMIT);
    expect(missing).toBeNull();
  });

  it('a cursor built from a real row round-trips (encodeThreadCursor + the page it produces agree)', async () => {
    const question = await makeQuestion();
    const author = await makeClaimedProfile();
    await createPost(
      db,
      { contextKind: 'question', contextId: question.id, author: { profileId: author.id as string, handle: author.handle, slug: author.slug }, body: 'only' },
      NOW,
    );
    const page = await getThreadPage(db, 'question', question.id, null, 1);
    const post = page.data.posts[0]!;
    const cursor = encodeThreadCursor({ createdAt: new Date(post.created_at), id: post.id });
    expect(cursor).toBe(page.meta.next_cursor);
  });
});

describe('createPost (§9.2 POST .../posts, claimed only enforced by caller)', () => {
  it('inserts a visible post and returns it serialized with the given author', async () => {
    const question = await makeQuestion();
    const author = await makeClaimedProfile();

    const post = await createPost(
      db,
      {
        contextKind: 'question',
        contextId: question.id,
        author: { profileId: author.id as string, handle: author.handle, slug: author.slug },
        body: 'hello thread',
      },
      NOW,
    );

    expect(post).not.toBeNull();
    expect(post!.body).toBe('hello thread');
    expect(post!.status).toBe('visible');
    expect(post!.context_kind).toBe('question');
    expect(post!.context_id).toBe(question.id);
  });

  it('returns null for a context_id that does not exist (route 404s)', async () => {
    const author = await makeClaimedProfile();
    const post = await createPost(
      db,
      {
        contextKind: 'question',
        contextId: uuidv7(),
        author: { profileId: author.id as string, handle: author.handle, slug: author.slug },
        body: 'orphan',
      },
      NOW,
    );
    expect(post).toBeNull();
  });
});

describe('submitReaction (§9.2 POST /reactions, ghost+, toggle semantics)', () => {
  it('adds on the first call, removes on the second identical call', async () => {
    const question = await makeQuestion();
    const author = await makeClaimedProfile();
    const input = { contextKind: 'question' as const, contextId: question.id, profileId: author.id as string, emoji: '🔥' };

    const first = await submitReaction(db, input);
    expect(first).toBe('added');
    const afterAdd = await getThreadPage(db, 'question', question.id, null, THREAD_DEFAULT_LIMIT);
    expect(afterAdd.data.reaction_counts).toEqual([{ emoji: '🔥', count: 1 }]);

    const second = await submitReaction(db, input);
    expect(second).toBe('removed');
    const afterRemove = await getThreadPage(db, 'question', question.id, null, THREAD_DEFAULT_LIMIT);
    expect(afterRemove.data.reaction_counts).toEqual([]);
  });

  it('returns null for a context that does not exist (route 404s)', async () => {
    const author = await makeClaimedProfile();
    const result = await submitReaction(db, {
      contextKind: 'question',
      contextId: uuidv7(),
      profileId: author.id as string,
      emoji: '🔥',
    });
    expect(result).toBeNull();
  });

  it('two different profiles can each react with the same emoji (count 2, both toggleable independently)', async () => {
    const question = await makeQuestion();
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();

    await submitReaction(db, { contextKind: 'question', contextId: question.id, profileId: a.id as string, emoji: '💀' });
    await submitReaction(db, { contextKind: 'question', contextId: question.id, profileId: b.id as string, emoji: '💀' });

    const page = await getThreadPage(db, 'question', question.id, null, THREAD_DEFAULT_LIMIT);
    expect(page.data.reaction_counts).toEqual([{ emoji: '💀', count: 2 }]);

    await submitReaction(db, { contextKind: 'question', contextId: question.id, profileId: a.id as string, emoji: '💀' });
    const afterOneLeft = await getThreadPage(db, 'question', question.id, null, THREAD_DEFAULT_LIMIT);
    expect(afterOneLeft.data.reaction_counts).toEqual([{ emoji: '💀', count: 1 }]);
  });
});
