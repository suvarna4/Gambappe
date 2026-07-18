/**
 * Unit coverage for `lib/pick-client.ts`'s request/parse/error-mapping logic, via a stubbed
 * `fetch` — no network, no real WS3-T2 endpoints needed (see that file's header comment on
 * why those endpoints don't exist on this branch yet).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, fetchMe, placePick, undoPick } from '@/lib/pick-client';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMe', () => {
  it('parses a valid GET /me success envelope and surfaces the server-time offset', async () => {
    const mePayload = {
      profile: {
        profile_id: '018f1e2b-0000-7000-8000-000000000001',
        handle: 'Fox #1234',
        slug: 'fox-1234',
        kind: 'ghost',
        status: 'active',
        handle_is_generated: true,
        created_at: '2026-07-01T00:00:00Z',
        claimed_at: null,
        age_attested: false,
        timezone: null,
        streak: { current: 0, best: 0, freeze_bank: 0, last_counted_date: null },
        win_streak: { current: 0, best: 0 },
      },
      settings: {
        nemesis_paused: false,
        show_wallet_address: false,
        notifications: {
          email_reveal: true,
          email_nemesis: true,
          email_duo: true,
          email_product: false,
          push_reveal: true,
          push_nemesis: true,
          push_duo: true,
        },
      },
      eligibility: {
        graded_picks: 0,
        nemesis_required: 5,
        duo_required: 10,
        nemesis_eligible: false,
        duo_eligible: false,
      },
      claim: { claimed: false },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: mePayload }, { headers: { 'x-server-time': '1700000000000' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMe();
    expect(result.data.profile.handle).toBe('Fox #1234');
    expect(result.data.profile.age_attested).toBe(false);
    expect(result.serverTimeMs).toBe(1_700_000_000_000);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws ApiClientError with the real error code on an {error} envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'nope' } }, { status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMe()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('wraps a network failure as NETWORK_ERROR rather than throwing raw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(fetchMe()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('a response that does not match the contract schema fails as PARSE_ERROR, not a silent pass-through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { profile: { nope: true } } })),
    );
    await expect(fetchMe()).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });
});

describe('placePick (§6.2) — not merged yet (WS3-T2), but the client contract is exercised here', () => {
  it('sends the exact §6.2 body shape and parses the 201 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            pick: {
              id: '018f1e2b-0000-7000-8000-000000000002',
              question_id: '018f1e2b-0000-7000-8000-000000000003',
              profile_id: '018f1e2b-0000-7000-8000-000000000001',
              side: 'yes',
              yes_price_at_entry: 0.63,
              price_stamped_at: '2026-07-19T13:00:00Z',
              picked_at: '2026-07-19T13:00:00Z',
              source: 'web',
              confidence: null,
              result: 'pending',
              edge: null,
            },
            undo_until: '2026-07-19T13:01:00Z',
          },
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await placePick('018f1e2b-0000-7000-8000-000000000003', {
      side: 'yes',
      age_attested: true,
    });
    expect(result.data.pick.side).toBe('yes');
    expect(result.data.undo_until).toBe('2026-07-19T13:01:00Z');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body as string)).toEqual({ side: 'yes', age_attested: true });
  });

  it('surfaces ALREADY_PICKED with the echoed pick in details (§6.2 step 5, idempotent-friendly)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            {
              error: {
                code: 'ALREADY_PICKED',
                message: 'already picked',
                details: { pick: { id: 'p1', side: 'no', picked_at: '2026-07-19T13:00:00Z' } },
              },
            },
            { status: 409 },
          ),
        ),
    );
    await expect(placePick('q1', { side: 'yes' })).rejects.toMatchObject({
      code: 'ALREADY_PICKED',
      details: { pick: { side: 'no' } },
    });
  });

  it('rejects a client-side attempt to send an unknown body field before ever hitting the network (zod .strict())', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // @ts-expect-error deliberately passing an invalid body to prove the client validates first
    await expect(placePick('q1', { side: 'yes', stake: 100 })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('undoPick (§6.2 undo)', () => {
  it('DELETEs the right path and parses {deleted:true}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { deleted: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await undoPick('p1');
    expect(result.data.deleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/picks/p1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('surfaces UNDO_EXPIRED', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'UNDO_EXPIRED', message: 'too late' } }, { status: 422 }),
        ),
    );
    await expect(undoPick('p1')).rejects.toBeInstanceOf(ApiClientError);
  });
});
