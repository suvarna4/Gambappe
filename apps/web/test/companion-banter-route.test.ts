/**
 * XH-T6 route unit tests (docs/xtrace-hackathon-tasks.md) for `GET /api/v1/pairings/:id/banter`
 * — existing route-test style, with `@/lib/companion/banter` (the business logic) and identity
 * resolution mocked so the route handler itself can be invoked directly in plain vitest
 * (`vitest.config.ts`'s `@` alias is set up exactly for this — see its header comment).
 * `@/lib/rate-limit`'s backstop/rate-limit calls are also mocked to avoid a real Redis
 * dependency; `getPairingRequestSchema`'s param parsing runs for real (pure zod, no I/O).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const PAIRING_ID = '018f1e2b-0000-7000-8000-000000000001';
const PROFILE_ID = '018f1e2b-0000-7000-8000-000000000002';

const mockResolveIdentity = vi.fn();
vi.mock('@/lib/identity-request', () => ({
  resolveIdentityFromRequest: (...args: unknown[]) => mockResolveIdentity(...args),
}));

vi.mock('@/lib/stores', () => ({
  getDb: () => ({}),
}));

const mockEnforceGetBackstop = vi.fn().mockResolvedValue(null);
const mockEnforceRateLimit = vi.fn().mockResolvedValue(null);
vi.mock('@/lib/rate-limit', () => ({
  enforceGetBackstop: (...args: unknown[]) => mockEnforceGetBackstop(...args),
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

const mockLoadPairing = vi.fn();
const mockGetCacheHit = vi.fn();
const mockGenerateAndCache = vi.fn();
vi.mock('@/lib/companion/banter', () => ({
  loadPairingForBanter: (...args: unknown[]) => mockLoadPairing(...args),
  getBanterCacheHit: (...args: unknown[]) => mockGetCacheHit(...args),
  generateAndCacheBanter: (...args: unknown[]) => mockGenerateAndCache(...args),
  getXtraceClient: () => null,
  getGenerator: () => null,
}));

const { GET } = await import('@/app/api/v1/pairings/[id]/banter/route');
const { ApiError } = await import('@receipts/core');

function makeRequest(): Request {
  return new Request(`http://localhost/api/v1/pairings/${PAIRING_ID}/banter`);
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function bodyOf(res: Response): Promise<{ data?: unknown; error?: { code: string } }> {
  return res.json() as Promise<{ data?: unknown; error?: { code: string } }>;
}

describe('GET /api/v1/pairings/:id/banter — flag/auth gating', () => {
  const originalFlag = process.env.FLAG_COMPANION;
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.FLAG_COMPANION;
    else process.env.FLAG_COMPANION = originalFlag;
    vi.clearAllMocks();
  });

  it('returns 404 when the companion flag is disabled', async () => {
    process.env.FLAG_COMPANION = 'false';
    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(404);
    expect(mockResolveIdentity).not.toHaveBeenCalled();
  });

  it('returns 401 for a ghost (non-claimed) caller', async () => {
    process.env.FLAG_COMPANION = 'true';
    mockResolveIdentity.mockResolvedValue({ identity: { kind: 'ghost', profile: {} } });
    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(401);
    expect(mockLoadPairing).not.toHaveBeenCalled();
  });

  it('returns 403 for a claimed caller who is not a participant', async () => {
    process.env.FLAG_COMPANION = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockLoadPairing.mockRejectedValue(
      new ApiError('FORBIDDEN', "only the pairing's own two players"),
    );
    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/pairings/:id/banter — cache + rate limit ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
    process.env.FLAG_COMPANION = 'true';
  });

  it('returns the cached artifact without consuming the rate limit or invoking generation', async () => {
    process.env.FLAG_COMPANION = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockLoadPairing.mockResolvedValue({ id: PAIRING_ID });
    mockGetCacheHit.mockResolvedValue({
      lines: ['cached line'],
      generated_at: '2026-07-01T00:00:00.000Z',
    });

    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toEqual({
      banter: { lines: ['cached line'], generated_at: '2026-07-01T00:00:00.000Z' },
    });
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateAndCache).not.toHaveBeenCalled();
  });

  it('enforces the rate limit and generates on a cache miss', async () => {
    process.env.FLAG_COMPANION = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockLoadPairing.mockResolvedValue({ id: PAIRING_ID });
    mockGetCacheHit.mockResolvedValue(null);
    mockGenerateAndCache.mockResolvedValue({
      lines: ['fresh line'],
      generated_at: '2026-07-02T00:00:00.000Z',
    });

    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toEqual({
      banter: { lines: ['fresh line'], generated_at: '2026-07-02T00:00:00.000Z' },
    });
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('companion_banter', PROFILE_ID);
    expect(mockGenerateAndCache).toHaveBeenCalledTimes(1);
  });

  it('returns {banter: null} with 200 when generation is unavailable (degraded, not an error)', async () => {
    process.env.FLAG_COMPANION = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockLoadPairing.mockResolvedValue({ id: PAIRING_ID });
    mockGetCacheHit.mockResolvedValue(null);
    mockGenerateAndCache.mockResolvedValue(null);

    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toEqual({ banter: null });
  });

  it('returns the ready-made 429 without generating when the rate limit is exhausted', async () => {
    process.env.FLAG_COMPANION = 'true';
    mockResolveIdentity.mockResolvedValue({
      identity: { kind: 'claimed', profile: { id: PROFILE_ID }, userId: 'u1' },
    });
    mockLoadPairing.mockResolvedValue({ id: PAIRING_ID });
    mockGetCacheHit.mockResolvedValue(null);
    const rateLimited = new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
      status: 429,
    });
    mockEnforceRateLimit.mockResolvedValue(rateLimited);

    const res = await GET(makeRequest(), paramsFor(PAIRING_ID));
    expect(res.status).toBe(429);
    expect(mockGenerateAndCache).not.toHaveBeenCalled();
  });
});
