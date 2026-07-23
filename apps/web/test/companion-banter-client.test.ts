/**
 * XH-T6 island unit AC (docs/xtrace-hackathon-tasks.md): `fetchCompanionBanter` — the extracted
 * fetch → envelope-unwrap → parse step — stubbed via `global.fetch` (`vi.stubGlobal` style of
 * `share-client.test.ts`). The stub MUST return the ENVELOPED shape `{ data: { banter: ... } }`
 * so the unwrap step is actually exercised — a stub of the bare `{ banter }` shape would pass
 * against the exact bug this test exists to catch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCompanionBanter } from '@/lib/companion/banter-client';

describe('fetchCompanionBanter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('unwraps the envelope and returns the banter payload on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        data: {
          banter: { lines: ['line one', 'line two'], generated_at: '2026-07-13T00:00:00.000Z' },
        },
      }),
    }) as unknown as typeof fetch;

    await expect(fetchCompanionBanter('pairing-1')).resolves.toEqual({
      lines: ['line one', 'line two'],
      generated_at: '2026-07-13T00:00:00.000Z',
    });
  });

  it('returns null (render-nothing) for a degraded { banter: null } response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: { banter: null } }),
    }) as unknown as typeof fetch;

    await expect(fetchCompanionBanter('pairing-1')).resolves.toBeNull();
  });

  it('returns null (render-nothing) on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ error: { code: 'INTERNAL', message: 'boom' } }),
    }) as unknown as typeof fetch;

    await expect(fetchCompanionBanter('pairing-1')).resolves.toBeNull();
  });

  it('returns null (render-nothing) on a schema-validation failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: { banter: { lines: 'not an array' } } }),
    }) as unknown as typeof fetch;

    await expect(fetchCompanionBanter('pairing-1')).resolves.toBeNull();
  });

  it('returns null (render-nothing) on a JSON parse failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => {
        throw new Error('invalid JSON');
      },
    }) as unknown as typeof fetch;

    await expect(fetchCompanionBanter('pairing-1')).resolves.toBeNull();
  });

  it('returns null (render-nothing) on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    await expect(fetchCompanionBanter('pairing-1')).resolves.toBeNull();
  });
});
