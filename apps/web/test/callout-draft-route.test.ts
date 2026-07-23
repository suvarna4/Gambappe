/**
 * XH-T7 route unit tests (docs/xtrace-hackathon-tasks.md) for `POST /api/v1/callouts/draft` —
 * same pattern as `companion-banter-route.test.ts`: `@/lib/companion/callout-draft` (and
 * `@/lib/companion/banter`'s exported singleton getters) are mocked so the route handler can be
 * invoked directly in plain vitest. `@/lib/origin-check`'s `assertSameOrigin` is exercised for
 * real (same-origin requests only; see `origin-check.test.ts` for its own coverage) by giving
 * every request a `Sec-Fetch-Site: same-origin` header (see `origin-check.test.ts` for why that
 * takes priority over `Origin`).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const PROFILE_ID = '018f1e2b-0000-7000-8000-000000000002';
const TARGET_ID = '018f1e2b-0000-7000-8000-000000000003';

const mockResolveIdentity = vi.fn();
vi.mock('@/lib/identity-request', () => ({
  resolveIdentityFromRequest: (...args: unknown[]) => mockResolveIdentity(...args),
}));

vi.mock('@/lib/stores', () => ({
  getDb: () => ({}),
}));

const mockEnforceRateLimit = vi.fn().mockResolvedValue(null);
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

vi.mock('@/lib/companion/banter', () => ({
  getXtraceClient: () => null,
  getGenerator: () => null,
}));

const mockAuthorize = vi.fn();
const mockGetCacheHit = vi.fn();
const mockGenerateAndCache = vi.fn();
vi.mock('@/lib/companion/callout-draft', () => ({
  authorizeDraftTarget: (...args: unknown[]) => mockAuthorize(...args),
  getDraftCacheHit: (...args: unknown[]) => mockGetCacheHit(...args),
  generateAndCacheCalloutDraft: (...args: unknown[]) => mockGenerateAndCache(...args),
}));

const { POST } = await import('@/app/api/v1/callouts/draft/route');
const { ApiError } = await import('@receipts/core');

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';
});

function makeRequest(targetProfileId: string | undefined = TARGET_ID): Request {
  return new Request('http://localhost/api/v1/callouts/draft', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ target_profile_id: targetProfileId }),
  });
}

async function bodyOf(res: Response): Promise<{ data?: unknown; error?: { code: string } }> {
  return res.json() as Promise<{ data?: unknown; error?: { code: string } }>;
}

describe('POST /api/v1/callouts/draft — flag/auth/authorization gating', () => {
  const originalFlag = process.env.FLAG_CALLOUT_DRAFT;
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.FLAG_CALLOUT_DRAFT;
    else process.env.FLAG_CALLOUT_DRAFT = originalFlag;
    vi.clearAllMocks();
  });

  it('returns 404 when the callout_draft flag is disabled', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'false';
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(mockResolveIdentity).not.toHaveBeenCalled();
  });

  it('returns 401 for a ghost (non-claimed) caller', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'true';
    mockResolveIdentity.mockResolvedValue({ identity: { kind: 'ghost', profile: {} } });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it('returns 403 for a stranger target (no completed pairing, not a call-out candidate)', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockAuthorize.mockRejectedValue(
      new ApiError('FORBIDDEN', 'no shared history with this target'),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockGetCacheHit).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/callouts/draft — cache + rate limit ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
    process.env.FLAG_CALLOUT_DRAFT = 'true';
  });

  it('returns the cached drafts without consuming the rate limit or invoking generation', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockAuthorize.mockResolvedValue([]);
    mockGetCacheHit.mockResolvedValue(['cached draft line']);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toEqual({ drafts: ['cached draft line'] });
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateAndCache).not.toHaveBeenCalled();
  });

  it('enforces the rate limit and generates on a cache miss, reusing the authorized prior-pairing ids', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    const priorPairingIds = ['pairing-1'];
    mockAuthorize.mockResolvedValue(priorPairingIds);
    mockGetCacheHit.mockResolvedValue(null);
    mockGenerateAndCache.mockResolvedValue(['fresh draft line']);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toEqual({ drafts: ['fresh draft line'] });
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('callout_draft', PROFILE_ID);
    expect(mockGenerateAndCache).toHaveBeenCalledWith(
      {},
      null,
      null,
      PROFILE_ID,
      TARGET_ID,
      priorPairingIds,
      expect.any(String),
    );
  });

  it('returns 503 COMPANION_UNAVAILABLE when generation is degraded (not a silent {drafts: []})', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockAuthorize.mockResolvedValue([]);
    mockGetCacheHit.mockResolvedValue(null);
    mockGenerateAndCache.mockRejectedValue(
      new ApiError('COMPANION_UNAVAILABLE', 'draft generation unavailable'),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    const body = await bodyOf(res);
    expect(body.error?.code).toBe('COMPANION_UNAVAILABLE');
  });

  it('returns the ready-made 429 without generating when the rate limit is exhausted', async () => {
    process.env.FLAG_CALLOUT_DRAFT = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockAuthorize.mockResolvedValue([]);
    mockGetCacheHit.mockResolvedValue(null);
    const rateLimited = new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
      status: 429,
    });
    mockEnforceRateLimit.mockResolvedValue(rateLimited);

    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(mockGenerateAndCache).not.toHaveBeenCalled();
  });
});
