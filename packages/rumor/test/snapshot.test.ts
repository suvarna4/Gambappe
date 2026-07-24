import { describe, expect, it } from 'vitest';

import { assembleSnapshot, hashAuthor, isPostSnapshot } from '../src/index.js';
import type { PostSnapshot } from '../src/index.js';

const post = {
  id: '8vmgiz',
  subreddit: 'nba',
  title: 'LeBron heads west',
  selftext: '',
  score: 2754,
  createdUtc: 1530567000,
  numComments: 208,
};

const comment = {
  id: 'e1oiprx',
  parentId: null,
  authorHash: hashAuthor('someuser'),
  body: 'He is going to the Lakers.',
  score: 85,
  createdUtc: 1530567400,
};

describe('hashAuthor', () => {
  it('is deterministic and never echoes the handle', () => {
    expect(hashAuthor('someuser')).toBe(hashAuthor('someuser'));
    expect(hashAuthor('someuser')).not.toContain('someuser');
    expect(hashAuthor('someuser')).toMatch(/^[0-9a-f]{12}$/);
    expect(hashAuthor('otheruser')).not.toBe(hashAuthor('someuser'));
  });

  it('maps deleted/missing authors to the sentinel', () => {
    expect(hashAuthor('[deleted]')).toBe('deleted');
    expect(hashAuthor(null)).toBe('deleted');
    expect(hashAuthor(undefined)).toBe('deleted');
    expect(hashAuthor('')).toBe('deleted');
  });
});

describe('snapshot round-trip', () => {
  it('assembles a valid snapshot that survives JSON round-trip', () => {
    const snapshot = assembleSnapshot({
      source: 'arctic-shift',
      sagaId: 'lebron-2018',
      fetchedAt: '2026-07-24T00:00:00.000Z',
      post,
      comments: [comment],
    });
    expect(snapshot.version).toBe(1);
    expect(isPostSnapshot(snapshot)).toBe(true);
    expect(isPostSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
  });

  it('accepts a live capture with null sagaId', () => {
    const snapshot = assembleSnapshot({
      source: 'reddit-oauth',
      sagaId: null,
      fetchedAt: '2026-07-24T00:00:00.000Z',
      post,
      comments: [],
    });
    expect(isPostSnapshot(snapshot)).toBe(true);
  });

  it('accepts the reddit-json manual-fallback source', () => {
    const snapshot = assembleSnapshot({
      source: 'reddit-json',
      sagaId: 'lebron-2026',
      fetchedAt: '2026-07-24T00:00:00.000Z',
      post,
      comments: [],
    });
    expect(isPostSnapshot(snapshot)).toBe(true);
  });

  it('rejects structural corruption', () => {
    const good = assembleSnapshot({
      source: 'arctic-shift',
      sagaId: 'lebron-2018',
      fetchedAt: '2026-07-24T00:00:00.000Z',
      post,
      comments: [comment],
    });
    expect(isPostSnapshot(null)).toBe(false);
    expect(isPostSnapshot({})).toBe(false);
    expect(isPostSnapshot({ ...good, version: 2 })).toBe(false);
    expect(isPostSnapshot({ ...good, source: 'scraper' })).toBe(false);
    expect(isPostSnapshot({ ...good, post: { ...post, score: '2754' } })).toBe(false);
    const badComment: unknown = { ...good, comments: [{ ...comment, authorHash: 7 }] };
    expect(isPostSnapshot(badComment)).toBe(false);
  });

  it('type-narrows to PostSnapshot', () => {
    const value: unknown = assembleSnapshot({
      source: 'arctic-shift',
      sagaId: null,
      fetchedAt: '2026-07-24T00:00:00.000Z',
      post,
      comments: [],
    });
    if (isPostSnapshot(value)) {
      const narrowed: PostSnapshot = value;
      expect(narrowed.post.id).toBe('8vmgiz');
    } else {
      expect.unreachable('snapshot should validate');
    }
  });
});
