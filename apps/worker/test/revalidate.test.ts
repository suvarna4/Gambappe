/**
 * `lib/revalidate.ts` (audit finding 8.1): the worker→web ISR revalidation call is
 * best-effort by contract — the state transition is already committed when it runs, so it
 * must NEVER throw, whatever the env/network does. These tests pin that contract plus the
 * request shape the (separately-tested, WS8-T3) endpoint expects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { questionRevalidationPaths, requestRevalidation } from '../src/lib/revalidate.js';

const APP_URL = 'https://receipts.example';

describe('questionRevalidationPaths', () => {
  it('returns the question page + home for a slugged question', () => {
    expect(questionRevalidationPaths('2026-07-19-some-question')).toEqual([
      '/q/2026-07-19-some-question',
      '/',
    ]);
  });

  it('returns just home when the slug is null (defensive — dailies always have slugs)', () => {
    expect(questionRevalidationPaths(null)).toEqual(['/']);
  });
});

describe('requestRevalidation', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
    vi.stubEnv('INTERNAL_API_SECRET', 'test-internal-secret');
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POSTs the paths with the bearer secret to the internal revalidate endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { revalidated: ['/q/x', '/'], rejected: [] } }), { status: 200 }),
    );

    await requestRevalidation(['/q/x', '/']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${APP_URL}/api/v1/internal/revalidate`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-internal-secret');
    expect(JSON.parse(init.body as string)).toEqual({ paths: ['/q/x', '/'] });
  });

  it('no-ops without calling fetch when the env is not configured (dev/test workers)', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', '');
    await requestRevalidation(['/q/x']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(requestRevalidation(['/q/x'])).resolves.toBeUndefined();
  });

  it('never throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    await expect(requestRevalidation(['/q/x'])).resolves.toBeUndefined();
  });

  it('never throws on an unparseable success body', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(requestRevalidation(['/q/x'])).resolves.toBeUndefined();
  });
});
