/**
 * Arctic Shift response parsing + URL construction (docs/plans/ws27-rumor-radar.md §1/§2A,
 * WS27-T1). Arctic Shift (arctic-shift.photon-reddit.com) serves the Reddit archive that
 * preserves Pushshift-era upvotes — the historical-saga corpus source. Pure functions only:
 * the fetch loop with its proxy agent, pacing, and retries lives in
 * `scripts/fetch-sagas.mjs`, mirroring how @receipts/sim splits football-data parsing from
 * its fetch script.
 *
 * Empirical API notes (probed 2026-07-24, recorded in the plan's §1):
 * - `sort_type` supports only default/created_utc — score ranking happens client-side.
 * - `limit` caps at 100; pagination is by created_utc cursor (`after` accepts epoch seconds
 *   as well as YYYY-MM-DD).
 * - Recent comment scores are frozen at ~1 (ingest-time capture); pre-2023 rows are real.
 */
import { hashAuthor } from './snapshot.js';
import type { SnapshotComment, SnapshotPost } from './snapshot.js';

export const ARCTIC_SHIFT_BASE = 'https://arctic-shift.photon-reddit.com';

/** Hard API page cap — requests above this are rejected, not clamped, by the server. */
export const ARCTIC_SHIFT_PAGE_LIMIT = 100;

export function buildPostSearchUrl(args: {
  subreddit: string;
  titleQuery: string;
  /** YYYY-MM-DD or epoch seconds (exclusive lower bound when paginating). */
  after: string | number;
  /** YYYY-MM-DD (inclusive upper bound of the sweep). */
  before: string;
  limit?: number;
  base?: string;
}): string {
  const u = new URL('/api/posts/search', args.base ?? ARCTIC_SHIFT_BASE);
  u.searchParams.set('subreddit', args.subreddit);
  u.searchParams.set('title', args.titleQuery);
  u.searchParams.set('after', String(args.after));
  u.searchParams.set('before', args.before);
  u.searchParams.set('limit', String(args.limit ?? ARCTIC_SHIFT_PAGE_LIMIT));
  u.searchParams.set('sort', 'asc');
  u.searchParams.set('sort_type', 'created_utc');
  return u.toString();
}

export function buildCommentSearchUrl(args: {
  /** Bare post id (no t3_ prefix). */
  linkId: string;
  /** Epoch-seconds cursor for pagination; omit for the first page. */
  after?: number;
  limit?: number;
  base?: string;
}): string {
  const u = new URL('/api/comments/search', args.base ?? ARCTIC_SHIFT_BASE);
  u.searchParams.set('link_id', args.linkId);
  if (args.after !== undefined) u.searchParams.set('after', String(args.after));
  u.searchParams.set('limit', String(args.limit ?? ARCTIC_SHIFT_PAGE_LIMIT));
  u.searchParams.set('sort', 'asc');
  u.searchParams.set('sort_type', 'created_utc');
  return u.toString();
}

/**
 * Parse a posts-search response body into SnapshotPosts. Malformed rows are skipped, not
 * fatal — archives contain oddities and one bad row must not sink a sweep. A non-object
 * body or `data: null` (Arctic Shift's error shape) throws with the server's message.
 */
export function parsePostsResponse(body: unknown): SnapshotPost[] {
  const rows = extractDataRows(body);
  const out: SnapshotPost[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r['id'] !== 'string' ||
      typeof r['subreddit'] !== 'string' ||
      typeof r['title'] !== 'string' ||
      typeof r['created_utc'] !== 'number'
    ) {
      continue;
    }
    out.push({
      id: r['id'],
      subreddit: r['subreddit'],
      title: r['title'],
      selftext: typeof r['selftext'] === 'string' ? r['selftext'] : '',
      score: typeof r['score'] === 'number' ? r['score'] : 0,
      createdUtc: r['created_utc'],
      numComments: typeof r['num_comments'] === 'number' ? r['num_comments'] : 0,
    });
  }
  return out;
}

/**
 * Parse a comments-search response into SnapshotComments. Usernames are hashed HERE — raw
 * handles never leave this function. Reddit "thing" prefixes on parent_id are resolved:
 * t1_x → comment parent x, t3_x (the post) → null.
 */
export function parseCommentsResponse(body: unknown): SnapshotComment[] {
  const rows = extractDataRows(body);
  const out: SnapshotComment[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r['id'] !== 'string' ||
      typeof r['body'] !== 'string' ||
      typeof r['created_utc'] !== 'number'
    ) {
      continue;
    }
    const rawParent = typeof r['parent_id'] === 'string' ? r['parent_id'] : '';
    const parentId = rawParent.startsWith('t1_') ? rawParent.slice(3) : null;
    out.push({
      id: r['id'],
      parentId,
      authorHash: hashAuthor(typeof r['author'] === 'string' ? r['author'] : null),
      body: r['body'],
      score: typeof r['score'] === 'number' ? r['score'] : 0,
      createdUtc: r['created_utc'],
    });
  }
  return out;
}

function extractDataRows(body: unknown): unknown[] {
  if (typeof body !== 'object' || body === null) {
    throw new Error('arctic-shift: response body is not an object');
  }
  const data = (body as Record<string, unknown>)['data'];
  if (!Array.isArray(data)) {
    const error = (body as Record<string, unknown>)['error'];
    throw new Error(
      `arctic-shift: no data rows (${typeof error === 'string' ? error : 'unknown error'})`,
    );
  }
  return data;
}
