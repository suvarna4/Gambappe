/**
 * Cross-origin POST → 403 test (WS2-T2 AC): unit-testable, no DB needed — just construct a
 * Request with a mismatched Origin header and call the origin-check function directly.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@receipts/core';
import { assertSameOrigin } from '@/lib/origin-check';

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://receipts.example';
});

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request('https://receipts.example/api/v1/claim', { method, headers });
}

describe('assertSameOrigin (§11.2)', () => {
  it('never checks GET/HEAD', () => {
    expect(() => assertSameOrigin(req('GET'))).not.toThrow();
    expect(() => assertSameOrigin(req('HEAD'))).not.toThrow();
  });

  it('allows a same-origin POST (Sec-Fetch-Site: same-origin)', () => {
    expect(() => assertSameOrigin(req('POST', { 'sec-fetch-site': 'same-origin' }))).not.toThrow();
  });

  it('allows Sec-Fetch-Site: none (e.g. address-bar navigation)', () => {
    expect(() => assertSameOrigin(req('POST', { 'sec-fetch-site': 'none' }))).not.toThrow();
  });

  it('rejects a cross-site POST via Sec-Fetch-Site', () => {
    expect(() => assertSameOrigin(req('POST', { 'sec-fetch-site': 'cross-site' }))).toThrow(ApiError);
    try {
      assertSameOrigin(req('POST', { 'sec-fetch-site': 'cross-site' }));
    } catch (e) {
      expect(ApiError.is(e) && e.code).toBe('CSRF_REJECTED');
    }
  });

  it('falls back to Origin header when Sec-Fetch-Site is absent', () => {
    expect(() => assertSameOrigin(req('POST', { origin: 'https://receipts.example' }))).not.toThrow();
    expect(() => assertSameOrigin(req('POST', { origin: 'https://evil.example' }))).toThrow(ApiError);
  });

  it('fails closed when neither header is present', () => {
    expect(() => assertSameOrigin(req('POST'))).toThrow(ApiError);
  });
});
