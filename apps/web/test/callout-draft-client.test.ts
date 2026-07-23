/**
 * XH-T7 unit tests (docs/xtrace-hackathon-tasks.md) for `@/lib/companion/callout-draft-client` —
 * `fetchCalloutDrafts` (fetch → envelope-unwrap → parse → degrade-to-null, same shape as T6's
 * `companion-banter-client.test.ts`) and `createAndShareCallout` (the button's full click-to-
 * share flow: mint a callout link, then hand it + the selected draft to `shareCalloutLink`,
 * which is mocked here so the test only asserts the ORCHESTRATION, not the share mechanics
 * already covered by `callout-share.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockShareCalloutLink = vi.fn();
vi.mock('@/lib/callout-share', () => ({
  shareCalloutLink: (...args: unknown[]) => mockShareCalloutLink(...args),
}));

const { createAndShareCallout, fetchCalloutDrafts } =
  await import('@/lib/companion/callout-draft-client');

describe('fetchCalloutDrafts', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('unwraps the envelope and returns the drafts on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: { drafts: ['line one', 'line two'] } }),
    }) as unknown as typeof fetch;

    await expect(fetchCalloutDrafts('target-1')).resolves.toEqual(['line one', 'line two']);
  });

  it('returns null on a non-2xx response (e.g. the 503 COMPANION_UNAVAILABLE envelope)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({ error: { code: 'COMPANION_UNAVAILABLE', message: 'unavailable' } }),
    }) as unknown as typeof fetch;

    await expect(fetchCalloutDrafts('target-1')).resolves.toBeNull();
  });

  it('returns null on a schema-validation failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: { drafts: 'not an array' } }),
    }) as unknown as typeof fetch;

    await expect(fetchCalloutDrafts('target-1')).resolves.toBeNull();
  });

  it('returns null on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    await expect(fetchCalloutDrafts('target-1')).resolves.toBeNull();
  });
});

describe('createAndShareCallout', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('creates the callout then shares the link + selected draft as combined text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { share_url: 'https://x/rivals?callout=tok' } }),
    }) as unknown as typeof fetch;
    mockShareCalloutLink.mockResolvedValue(true);

    const copied = await createAndShareCallout('Otter #9001', 'you again? bring it');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/callouts',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
    expect(mockShareCalloutLink).toHaveBeenCalledWith(
      'https://x/rivals?callout=tok',
      'Call-out: Otter #9001',
      'you again? bring it',
    );
    expect(copied).toBe(true);
  });

  it('throws when the callout create call fails, without calling shareCalloutLink', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'rate limited' } }),
    }) as unknown as typeof fetch;

    await expect(createAndShareCallout('Otter #9001', 'draft')).rejects.toThrow('rate limited');
    expect(mockShareCalloutLink).not.toHaveBeenCalled();
  });
});
