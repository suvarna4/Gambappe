/**
 * Threads: posts + reactions repository (design doc §5.6, §9.2, WS7-T8). Generic over
 * `context_kind` (`question` | `pairing` | `duo_match`, §5.1 `thread_context`) — the same three
 * tables serve every thread surface, so this file has no question/pairing/duo_match-specific
 * logic at all; callers pass the context and own whichever parent-entity existence check makes
 * sense for their route (`getQuestionById`, `getPairingById`, `getDuoMatchById`, all already
 * exported from this package).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ThreadContext } from '@receipts/core';
import type { Db } from '../client.js';
import { posts, profiles, reactions } from '../schema/index.js';

export type PostRow = typeof posts.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;

export interface PostAuthor {
  profileId: string;
  handle: string;
  slug: string;
}

export interface PostWithAuthor {
  post: PostRow;
  author: PostAuthor;
}

/** Opaque cursor: the last row's (created_at, id) — the thread's own sort key. */
export interface ThreadCursor {
  createdAt: string;
  id: string;
}

export interface NewPostInput {
  id: string;
  contextKind: ThreadContext;
  contextId: string;
  profileId: string;
  body: string;
}

export async function insertPost(db: Db, input: NewPostInput, at: Date): Promise<PostRow> {
  const [row] = await db
    .insert(posts)
    .values({
      id: input.id,
      contextKind: input.contextKind,
      contextId: input.contextId,
      profileId: input.profileId,
      body: input.body,
      status: 'visible',
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  if (!row) throw new Error('insertPost: no row returned');
  return row;
}

/**
 * Visible posts for a thread, oldest first (a "thread" reads top-to-bottom chronologically —
 * SPEC-GAP(ws7-t8): §9.2 doesn't pin a sort order for `GET .../thread` pagination, unlike the
 * §9.2 profile pick log which is explicitly "newest first"; this mirrors that keyset-cursor
 * shape (`ProfilePicksCursor` in `profile-page.ts`) but ascending, matching a conversation's
 * natural reading order). Uses the `posts_context_created_idx` index (§5.6).
 */
export async function listVisiblePostsForContext(
  db: Db,
  contextKind: ThreadContext,
  contextId: string,
  cursor: ThreadCursor | null,
  limit: number,
): Promise<PostWithAuthor[]> {
  const conditions = [
    eq(posts.contextKind, contextKind),
    eq(posts.contextId, contextId),
    eq(posts.status, 'visible'),
  ];
  if (cursor) {
    conditions.push(
      sql`(${posts.createdAt}, ${posts.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select({
      post: posts,
      authorProfileId: profiles.id,
      authorHandle: profiles.handle,
      authorSlug: profiles.slug,
    })
    .from(posts)
    .innerJoin(profiles, eq(profiles.id, posts.profileId))
    .where(and(...conditions))
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .limit(limit);

  return rows.map((row) => ({
    post: row.post,
    author: { profileId: row.authorProfileId, handle: row.authorHandle, slug: row.authorSlug },
  }));
}

export interface ReactionCount {
  emoji: string;
  count: number;
}

/** Aggregate reaction counts by emoji for a thread context (§9.2 "posts + reaction counts"). */
export async function countReactionsForContext(
  db: Db,
  contextKind: ThreadContext,
  contextId: string,
): Promise<ReactionCount[]> {
  const rows = await db
    .select({ emoji: reactions.emoji, count: sql<number>`count(*)::int` })
    .from(reactions)
    .where(and(eq(reactions.contextKind, contextKind), eq(reactions.contextId, contextId)))
    .groupBy(reactions.emoji);
  return rows;
}

export interface ToggleReactionInput {
  contextKind: ThreadContext;
  contextId: string;
  profileId: string;
  emoji: string;
}

/**
 * Toggle semantics (§9.2: "2nd call removes"). Delete-if-present else insert, in one
 * transaction. The unique index `(context_kind, context_id, profile_id, emoji)` (§5.6) is the
 * real correctness backstop: if two requests from the SAME profile race between this delete and
 * insert (e.g. a rapid double-tap), `onConflictDoNothing` means the loser's insert is a no-op
 * rather than an error — the row ends up existing either way, which is the state a genuine
 * double-tap-to-add should converge to, so that race is reported as 'added' regardless of which
 * request "won".
 */
export async function toggleReaction(db: Db, input: ToggleReactionInput): Promise<'added' | 'removed'> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(reactions)
      .where(
        and(
          eq(reactions.contextKind, input.contextKind),
          eq(reactions.contextId, input.contextId),
          eq(reactions.profileId, input.profileId),
          eq(reactions.emoji, input.emoji),
        ),
      )
      .returning({ id: reactions.id });
    if (deleted.length > 0) return 'removed';

    await tx
      .insert(reactions)
      .values({
        id: uuidv7(),
        contextKind: input.contextKind,
        contextId: input.contextId,
        profileId: input.profileId,
        emoji: input.emoji,
      })
      .onConflictDoNothing();
    return 'added';
  });
}
