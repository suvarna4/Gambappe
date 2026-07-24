/**
 * Post snapshot format (docs/plans/ws27-rumor-radar.md §2A, WS27-T1). One snapshot = one
 * Reddit post plus its comment tree, captured EXACTLY ONCE (owner decision 2026-07-24:
 * capture-once at ≥2h — there is deliberately no version axis in this format; `fetchedAt`
 * is an audit stamp, not a version). Both fetchers — Arctic Shift (historical sagas) and
 * Reddit OAuth (live, WS27-T6) — produce this same shape, so everything downstream is
 * source-agnostic.
 *
 * Privacy rule (plan §6): usernames never enter a snapshot — `authorHash` is a truncated
 * SHA-256 of the handle, computed at snapshot-assembly time. The hash is deterministic on
 * purpose (same commenter recognizable across posts, e.g. for future brigade damping)
 * without storing who they are.
 */
import { createHash } from 'node:crypto';

export interface SnapshotPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  /** Upvote score at capture time — the weighting signal. */
  score: number;
  /** Unix seconds. */
  createdUtc: number;
  numComments: number;
}

export interface SnapshotComment {
  id: string;
  /** Parent comment id, or null for top-level comments (parent is the post itself). */
  parentId: string | null;
  authorHash: string;
  body: string;
  /** Upvote score at capture time — the weighting signal. */
  score: number;
  /** Unix seconds. */
  createdUtc: number;
}

export type SnapshotSource = 'arctic-shift' | 'reddit-oauth';

export interface PostSnapshot {
  version: 1;
  source: SnapshotSource;
  /** Saga this capture belongs to, or null for the live (unresolved) saga. */
  sagaId: string | null;
  /** ISO timestamp of the one capture — audit stamp, never a version key. */
  fetchedAt: string;
  post: SnapshotPost;
  comments: SnapshotComment[];
}

/** Truncated (48-bit hex) SHA-256 of a Reddit handle; '[deleted]'/empty map to 'deleted'. */
export function hashAuthor(author: string | null | undefined): string {
  if (!author || author === '[deleted]') return 'deleted';
  return createHash('sha256').update(author).digest('hex').slice(0, 12);
}

export function assembleSnapshot(args: {
  source: SnapshotSource;
  sagaId: string | null;
  fetchedAt: string;
  post: SnapshotPost;
  comments: SnapshotComment[];
}): PostSnapshot {
  return {
    version: 1,
    source: args.source,
    sagaId: args.sagaId,
    fetchedAt: args.fetchedAt,
    post: args.post,
    comments: args.comments,
  };
}

/** Structural validation for snapshots loaded from disk — never trust a blob. */
export function isPostSnapshot(value: unknown): value is PostSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s['version'] !== 1) return false;
  if (s['source'] !== 'arctic-shift' && s['source'] !== 'reddit-oauth') return false;
  if (s['sagaId'] !== null && typeof s['sagaId'] !== 'string') return false;
  if (typeof s['fetchedAt'] !== 'string') return false;
  const post = s['post'] as Record<string, unknown> | null;
  if (typeof post !== 'object' || post === null) return false;
  if (
    typeof post['id'] !== 'string' ||
    typeof post['subreddit'] !== 'string' ||
    typeof post['title'] !== 'string' ||
    typeof post['selftext'] !== 'string' ||
    typeof post['score'] !== 'number' ||
    typeof post['createdUtc'] !== 'number' ||
    typeof post['numComments'] !== 'number'
  ) {
    return false;
  }
  const comments = s['comments'];
  if (!Array.isArray(comments)) return false;
  return comments.every((c: unknown) => {
    if (typeof c !== 'object' || c === null) return false;
    const r = c as Record<string, unknown>;
    return (
      typeof r['id'] === 'string' &&
      (r['parentId'] === null || typeof r['parentId'] === 'string') &&
      typeof r['authorHash'] === 'string' &&
      typeof r['body'] === 'string' &&
      typeof r['score'] === 'number' &&
      typeof r['createdUtc'] === 'number'
    );
  });
}
