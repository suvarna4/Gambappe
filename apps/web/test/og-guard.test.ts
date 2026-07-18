/**
 * WS8-T1 unit: `ogVersionGuard` (§10.5 abuse guard) — a mismatched or missing `?v=` must
 * 302-redirect to the canonical URL and never fall through to a render; a matching `?v=`
 * must proceed (return null).
 */
import { describe, expect, it } from 'vitest';
import { ogVersionGuard } from '../lib/og/guard';

describe('ogVersionGuard', () => {
  it('returns null (proceed) when ?v= matches the canonical hash', () => {
    const req = new Request('https://receipts.example/api/og/question/foo?v=abc123');
    expect(ogVersionGuard(req, 'abc123')).toBeNull();
  });

  it('redirects to the canonical URL when ?v= is missing', () => {
    const req = new Request('https://receipts.example/api/og/question/foo');
    const res = ogVersionGuard(req, 'abc123');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(302);
    expect(res!.headers.get('location')).toBe('https://receipts.example/api/og/question/foo?v=abc123');
  });

  it('redirects to the canonical URL when ?v= is stale/wrong', () => {
    const req = new Request('https://receipts.example/api/og/question/foo?v=stale');
    const res = ogVersionGuard(req, 'abc123');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(302);
    expect(res!.headers.get('location')).toBe('https://receipts.example/api/og/question/foo?v=abc123');
  });

  it('redirects with garbage cache-busting query params rather than rendering', () => {
    const req = new Request('https://receipts.example/api/og/question/foo?v=' + 'x'.repeat(500));
    const res = ogVersionGuard(req, 'abc123');
    expect(res!.status).toBe(302);
  });

  it('preserves the path exactly, dropping any other query params on redirect', () => {
    const req = new Request('https://receipts.example/api/og/question/foo?v=wrong&extra=1');
    const res = ogVersionGuard(req, 'abc123');
    const location = new URL(res!.headers.get('location')!);
    expect(location.pathname).toBe('/api/og/question/foo');
    expect(location.searchParams.get('v')).toBe('abc123');
  });
});
