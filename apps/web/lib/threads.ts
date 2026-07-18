/**
 * Threads: posts + reaction orchestration (design doc §9.2, §5.6, §14.1, WS7-T8). Route handlers
 * stay thin (§4.3) — this module owns cursor codec, serialization, and the parent-entity
 * existence checks that turn a bad `context_id` into a clean `NOT_FOUND` instead of a foreign-key
 * constraint violation.
 *
 * Scope note: this task wires up the QUESTION thread surface end to end (`GET
 * /questions/:slug/thread`, `POST /questions/:id/posts`) plus the fully generic `POST
 * /reactions` (§9.2 — one endpoint for all three `thread_context` kinds). It deliberately does
 * NOT add `/api/v1/pairings/*` or `/api/v1/duo-matches/*` route folders: neither exists on `main`
 * yet (WS5-T4's own `pairings.ts` repo header notes "the full `/api/v1/pairings/*` route surface
 * ... lands separately"; WS6-T4 "Duo public/self APIs" is still `available`), and inventing those
 * namespaces here risks colliding with whichever task actually owns those pages. Every function
 * below is generic over `context_kind`, so wiring `/pairings/:id/thread` and
 * `/duo-matches/:id/thread` later is a thin route file reusing `getThreadPage`/`createPost`
 * as-is, not new logic.
 */
import { uuidv7 } from 'uuidv7';
import type { ThreadContext } from '@receipts/core';
import {
  countReactionsForContext,
  getDuoMatchById,
  getPairingById,
  getQuestionById,
  getQuestionBySlug,
  insertPost,
  listVisiblePostsForContext,
  toggleReaction,
  type Db,
  type PostWithAuthor,
  type ThreadCursor,
} from '@receipts/db';

export interface PostPublic {
  id: string;
  context_kind: ThreadContext;
  context_id: string;
  author: { profile_id: string; handle: string; slug: string };
  body: string;
  status: 'visible' | 'removed_by_mod' | 'removed_by_author';
  created_at: string;
}

export interface ReactionCountPublic {
  emoji: string;
  count: number;
}

/** SPEC-GAP(ws7-t8): §9.2 caps pagination at `PAGINATION_MAX_LIMIT` (50, §9.1) but doesn't pin a
 * default page size for thread pagination specifically — mirrors `PROFILE_PICKS_DEFAULT_LIMIT`'s
 * precedent (`profile-page.ts`) of picking a reasonable implementation default here rather than
 * inventing a scored `core/config.ts` constant for an unspecified UI page size. */
export const THREAD_DEFAULT_LIMIT = 20;

export interface ThreadPage {
  data: { posts: PostPublic[]; reaction_counts: ReactionCountPublic[] };
  meta: { next_cursor: string | null };
}

function serializePost(row: PostWithAuthor): PostPublic {
  return {
    id: row.post.id,
    context_kind: row.post.contextKind,
    context_id: row.post.contextId,
    author: {
      profile_id: row.author.profileId,
      handle: row.author.handle,
      slug: row.author.slug,
    },
    body: row.post.body,
    status: row.post.status,
    created_at: row.post.createdAt.toISOString(),
  };
}

// --- cursor codec (mirrors profile-page.ts's picks cursor pattern) -----------------------------

export function encodeThreadCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeThreadCursor(raw: string | null | undefined): ThreadCursor | null {
  if (!raw) return null;
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** The context's parent entity, so a bad/foreign `context_id` 404s cleanly rather than tripping
 * the `posts`/`reactions` foreign-key-shaped `context_id` at insert time (it isn't actually an
 * FK — `context_id` is polymorphic, §5.6 — so nothing in Postgres would catch this for us). */
async function contextExists(db: Db, contextKind: ThreadContext, contextId: string): Promise<boolean> {
  switch (contextKind) {
    case 'question':
      return (await getQuestionById(db, contextId)) !== null;
    case 'pairing':
      return (await getPairingById(db, contextId)) !== null;
    case 'duo_match':
      return (await getDuoMatchById(db, contextId)) !== null;
  }
}

/** §9.2 `GET .../thread`: posts + reaction counts, paginated. Generic over context. */
export async function getThreadPage(
  db: Db,
  contextKind: ThreadContext,
  contextId: string,
  cursor: string | null | undefined,
  limit: number,
): Promise<ThreadPage> {
  const decodedCursor = decodeThreadCursor(cursor);
  const [rows, reactionCounts] = await Promise.all([
    listVisiblePostsForContext(db, contextKind, contextId, decodedCursor, limit),
    countReactionsForContext(db, contextKind, contextId),
  ]);

  const last = rows.at(-1);
  const nextCursor =
    last && rows.length === limit ? encodeThreadCursor({ createdAt: last.post.createdAt, id: last.post.id }) : null;

  return {
    data: { posts: rows.map(serializePost), reaction_counts: reactionCounts },
    meta: { next_cursor: nextCursor },
  };
}

/** §9.2 `GET /questions/:slug/thread` — resolves the slug, then delegates to `getThreadPage`.
 * `null` means "no such question" (route 404s). */
export async function getQuestionThreadPage(
  db: Db,
  slug: string,
  cursor: string | null | undefined,
  limit: number,
): Promise<ThreadPage | null> {
  const question = await getQuestionBySlug(db, slug);
  if (!question) return null;
  return getThreadPage(db, 'question', question.id, cursor, limit);
}

export interface CreatePostInput {
  contextKind: ThreadContext;
  contextId: string;
  /** The caller's already-resolved profile (identity resolution ran before this, same as every
   * other mutation route, §6.1.1) — passed in rather than re-fetched, since the author of a post
   * is always the caller and the route already has the full profile row in hand. */
  author: { profileId: string; handle: string; slug: string };
  body: string;
}

/** §9.2 `POST .../posts` (claimed only — enforced by the caller resolving identity). `null`
 * means the context (question/pairing/duo_match) doesn't exist (route 404s). */
export async function createPost(db: Db, input: CreatePostInput, at: Date): Promise<PostPublic | null> {
  if (!(await contextExists(db, input.contextKind, input.contextId))) return null;

  const row = await insertPost(
    db,
    {
      id: uuidv7(),
      contextKind: input.contextKind,
      contextId: input.contextId,
      profileId: input.author.profileId,
      body: input.body,
    },
    at,
  );

  return {
    id: row.id,
    context_kind: row.contextKind,
    context_id: row.contextId,
    author: {
      profile_id: input.author.profileId,
      handle: input.author.handle,
      slug: input.author.slug,
    },
    body: row.body,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export interface SubmitReactionInput {
  contextKind: ThreadContext;
  contextId: string;
  profileId: string;
  emoji: string;
}

/** §9.2 `POST /reactions` — toggle semantics. `null` means the context doesn't exist (404). */
export async function submitReaction(db: Db, input: SubmitReactionInput): Promise<'added' | 'removed' | null> {
  if (!(await contextExists(db, input.contextKind, input.contextId))) return null;
  return toggleReaction(db, input);
}
