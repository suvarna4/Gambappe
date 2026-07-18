/**
 * WS7-T8 unit tests: `apps/web/lib/threads.ts`'s pure cursor codec (DB-touching behavior is
 * covered by `test/integration/threads.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { decodeThreadCursor, encodeThreadCursor } from '@/lib/threads';

describe('thread cursor codec', () => {
  it('round-trips created_at + id', () => {
    const createdAt = new Date('2026-07-20T12:00:00.000Z');
    const id = '018f1e2b-0000-7000-8000-000000000001';
    const encoded = encodeThreadCursor({ createdAt, id });
    const decoded = decodeThreadCursor(encoded);
    expect(decoded).toEqual({ createdAt: createdAt.toISOString(), id });
  });

  it('decodes null/undefined/empty as null', () => {
    expect(decodeThreadCursor(null)).toBeNull();
    expect(decodeThreadCursor(undefined)).toBeNull();
    expect(decodeThreadCursor('')).toBeNull();
  });

  it('decodes garbage input as null rather than throwing', () => {
    expect(decodeThreadCursor('not-a-real-cursor')).toBeNull();
    expect(decodeThreadCursor(Buffer.from('missing-pipe').toString('base64url'))).toBeNull();
  });
});
