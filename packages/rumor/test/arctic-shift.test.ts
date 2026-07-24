import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ARCTIC_SHIFT_PAGE_LIMIT,
  buildCommentSearchUrl,
  buildPostSearchUrl,
  parseCommentsResponse,
  parsePostsResponse,
} from '../src/index.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('url builders', () => {
  it('builds a post search url with created_utc paging', () => {
    const url = new URL(
      buildPostSearchUrl({
        subreddit: 'nba',
        titleQuery: 'lebron',
        after: '2018-06-25',
        before: '2018-07-01',
      }),
    );
    expect(url.origin).toBe('https://arctic-shift.photon-reddit.com');
    expect(url.pathname).toBe('/api/posts/search');
    expect(url.searchParams.get('subreddit')).toBe('nba');
    expect(url.searchParams.get('title')).toBe('lebron');
    expect(url.searchParams.get('after')).toBe('2018-06-25');
    expect(url.searchParams.get('before')).toBe('2018-07-01');
    expect(url.searchParams.get('limit')).toBe(String(ARCTIC_SHIFT_PAGE_LIMIT));
    expect(url.searchParams.get('sort_type')).toBe('created_utc');
  });

  it('builds a comment search url with an epoch cursor', () => {
    const url = new URL(buildCommentSearchUrl({ linkId: '8vmgiz', after: 1530567400 }));
    expect(url.pathname).toBe('/api/comments/search');
    expect(url.searchParams.get('link_id')).toBe('8vmgiz');
    expect(url.searchParams.get('after')).toBe('1530567400');
  });

  it('omits the cursor on the first page', () => {
    const url = new URL(buildCommentSearchUrl({ linkId: '8vmgiz' }));
    expect(url.searchParams.has('after')).toBe(false);
  });
});

describe('parsePostsResponse', () => {
  it('parses the real fixture into snapshot posts', () => {
    const posts = parsePostsResponse(fixture('arctic-posts.json'));
    expect(posts.length).toBe(3);
    for (const p of posts) {
      expect(p.subreddit).toBe('nba');
      expect(typeof p.score).toBe('number');
      expect(p.createdUtc).toBeGreaterThan(1_500_000_000);
    }
  });

  it('skips malformed rows without failing the page', () => {
    const posts = parsePostsResponse({
      data: [{ id: 'ok1', subreddit: 'nba', title: 't', created_utc: 1 }, { id: 42 }, null],
    });
    expect(posts.map((p) => p.id)).toEqual(['ok1']);
    expect(posts[0]?.selftext).toBe('');
    expect(posts[0]?.score).toBe(0);
  });

  it('throws on the API error shape', () => {
    expect(() => parsePostsResponse({ data: null, error: 'bad param' })).toThrow(/bad param/);
    expect(() => parsePostsResponse('nope')).toThrow(/not an object/);
  });
});

describe('parseCommentsResponse', () => {
  it('parses the real fixture, hashing every author', () => {
    const comments = parseCommentsResponse(fixture('arctic-comments.json'));
    expect(comments.length).toBe(12);
    for (const c of comments) {
      expect(c.authorHash === 'deleted' || /^[0-9a-f]{12}$/.test(c.authorHash)).toBe(true);
      // Raw fixture authors are user0..userN — none may leak through.
      expect(c.authorHash.startsWith('user')).toBe(false);
    }
  });

  it('resolves reddit thing prefixes on parent_id', () => {
    const comments = parseCommentsResponse({
      data: [
        {
          id: 'a',
          parent_id: 't3_8vmgiz',
          author: 'x',
          body: 'top level',
          score: 1,
          created_utc: 1,
        },
        { id: 'b', parent_id: 't1_a', author: 'y', body: 'reply', score: 2, created_utc: 2 },
      ],
    });
    expect(comments[0]?.parentId).toBeNull();
    expect(comments[1]?.parentId).toBe('a');
  });
});
