/**
 * Reddit official-API response parsing (docs/plans/ws27-rumor-radar.md §2A, WS27-T6).
 * Pure functions: the OAuth token dance and paced fetch loop live in
 * scripts/fetch-live-reddit.mjs. The public JSON endpoints are IP-blocked from
 * datacenters (plan §1), so the LIVE corpus rides oauth.reddit.com with app
 * credentials; these parsers turn its listing shapes into the same SnapshotPost /
 * SnapshotComment rows the Arctic Shift path produces — downstream never knows which
 * fetcher ran.
 *
 * Shapes handled:
 * - Search/listing pages: `{ data: { children: [{ kind: 't3', data: {...} }] } }`.
 * - Comment trees (`/comments/<id>` element [1]): nested `t1` nodes whose `replies` is
 *   either another listing or `""`; `more` nodes are skipped (capture-once takes the
 *   loaded tree as the record — plan decision 2026-07-24).
 */
import { hashAuthor } from './snapshot.js';
import type { SnapshotComment, SnapshotPost } from './snapshot.js';

export const REDDIT_OAUTH_BASE = 'https://oauth.reddit.com';
export const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

/** Minimum post age before its one-and-only capture (owner decision 2026-07-24). */
export const LIVE_CAPTURE_MIN_AGE_S = 2 * 3600;

interface ListingNode {
  kind?: unknown;
  data?: unknown;
}

function children(listing: unknown): ListingNode[] {
  if (typeof listing !== 'object' || listing === null) return [];
  const data = (listing as Record<string, unknown>)['data'];
  if (typeof data !== 'object' || data === null) return [];
  const kids = (data as Record<string, unknown>)['children'];
  return Array.isArray(kids) ? (kids as ListingNode[]) : [];
}

/** Parse a t3 listing page (search results) into SnapshotPosts; malformed rows skipped. */
export function parseRedditPostListing(body: unknown): SnapshotPost[] {
  const out: SnapshotPost[] = [];
  for (const node of children(body)) {
    if (node.kind !== 't3' || typeof node.data !== 'object' || node.data === null) continue;
    const d = node.data as Record<string, unknown>;
    if (
      typeof d['id'] !== 'string' ||
      typeof d['subreddit'] !== 'string' ||
      typeof d['title'] !== 'string' ||
      typeof d['created_utc'] !== 'number'
    ) {
      continue;
    }
    out.push({
      id: d['id'],
      subreddit: d['subreddit'],
      title: d['title'],
      selftext: typeof d['selftext'] === 'string' ? d['selftext'] : '',
      score: typeof d['score'] === 'number' ? d['score'] : 0,
      createdUtc: d['created_utc'],
      numComments: typeof d['num_comments'] === 'number' ? d['num_comments'] : 0,
    });
  }
  return out;
}

/**
 * Flatten a comment-tree listing (element [1] of a /comments/<id> response) into
 * SnapshotComments, depth-first. Usernames are hashed here; `more` stubs are skipped.
 */
export function flattenRedditComments(commentListing: unknown): SnapshotComment[] {
  const out: SnapshotComment[] = [];
  const walk = (listing: unknown): void => {
    for (const node of children(listing)) {
      if (node.kind !== 't1' || typeof node.data !== 'object' || node.data === null) continue;
      const d = node.data as Record<string, unknown>;
      if (
        typeof d['id'] !== 'string' ||
        typeof d['body'] !== 'string' ||
        typeof d['created_utc'] !== 'number'
      ) {
        continue;
      }
      const rawParent = typeof d['parent_id'] === 'string' ? d['parent_id'] : '';
      out.push({
        id: d['id'],
        parentId: rawParent.startsWith('t1_') ? rawParent.slice(3) : null,
        authorHash: hashAuthor(typeof d['author'] === 'string' ? d['author'] : null),
        body: d['body'],
        score: typeof d['score'] === 'number' ? d['score'] : 0,
        createdUtc: d['created_utc'],
      });
      if (d['replies'] && typeof d['replies'] === 'object') walk(d['replies']);
    }
  };
  walk(commentListing);
  return out;
}

/** True once a post is old enough for its capture-once snapshot. */
export function isCaptureReady(post: Pick<SnapshotPost, 'createdUtc'>, now: number): boolean {
  return now - post.createdUtc >= LIVE_CAPTURE_MIN_AGE_S;
}
