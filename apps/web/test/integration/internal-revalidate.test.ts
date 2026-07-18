/**
 * WS8-T3 integration: `POST /api/v1/internal/revalidate` (design doc §9.2, §10.2) against a
 * real Redis (rate limit) — no Postgres needed, this route never touches the DB. Covers the
 * task's hardening AC directly: missing/wrong bearer → 401 (never touches the allowlist or
 * rate limit budget), out-of-allowlist paths rejected (not silently dropped, not a hard
 * failure), over-cap payload rejected by the zod schema, and the global rate limit itself.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = new Redis(redisUrl);

const SECRET = 'test-internal-secret-value';

beforeEach(async () => {
  await redis.flushdb();
  process.env.REDIS_URL = redisUrl;
  process.env.INTERNAL_API_SECRET = SECRET;
});

afterAll(async () => {
  await redis.quit();
});

async function post(body: unknown, bearer?: string): Promise<{ status: number; json: unknown }> {
  const { POST } = await import('../../app/api/v1/internal/revalidate/route.js');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  const request = new Request('http://localhost/api/v1/internal/revalidate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return { status: response.status, json: await response.json() };
}

describe('POST /api/v1/internal/revalidate (§9.2)', () => {
  it('401s with no bearer token at all', async () => {
    const { status } = await post({ paths: ['/q'] }, undefined);
    expect(status).toBe(401);
  });

  it('401s with the wrong bearer token', async () => {
    const { status } = await post({ paths: ['/q'] }, 'not-the-secret');
    expect(status).toBe(401);
  });

  it('401s when INTERNAL_API_SECRET is unset server-side (fail closed)', async () => {
    delete process.env.INTERNAL_API_SECRET;
    const { status } = await post({ paths: ['/q'] }, SECRET);
    expect(status).toBe(401);
    process.env.INTERNAL_API_SECRET = SECRET;
  });

  it('accepts an allowlisted path and reports it revalidated', async () => {
    const { status, json } = await post({ paths: ['/q'] }, SECRET);
    expect(status).toBe(200);
    expect(json).toMatchObject({ data: { revalidated: ['/q'], rejected: [] } });
  });

  it('accepts every allowlisted route pattern (/, /q, /q/:slug, /p/:slug, /vs/:id, /duos/:id)', async () => {
    const paths = ['/', '/q', '/q/today-slug', '/p/some-handle', '/vs/some-id', '/duos/some-id'];
    const { status, json } = await post({ paths }, SECRET);
    expect(status).toBe(200);
    expect(json).toMatchObject({ data: { revalidated: paths, rejected: [] } });
  });

  it('rejects an out-of-allowlist path without failing the whole call', async () => {
    const { status, json } = await post({ paths: ['/q', '/admin/secret-page'] }, SECRET);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      data: { revalidated: ['/q'], rejected: ['/admin/secret-page'] },
    });
  });

  it('rejects a path attempting traversal/host-confusion outside the allowlist patterns', async () => {
    const { json } = await post({ paths: ['https://evil.example/q', '/q/../../etc'] }, SECRET);
    expect(json).toMatchObject({ data: { revalidated: [], rejected: ['https://evil.example/q', '/q/../../etc'] } });
  });

  it('rejects a payload over REVALIDATE_MAX_PATHS (20) with 400, not a partial success', async () => {
    const paths = Array.from({ length: 21 }, (_, i) => `/q/slug-${i}`);
    const { status, json } = await post({ paths }, SECRET);
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('rejects an empty paths array (schema min 1)', async () => {
    const { status } = await post({ paths: [] }, SECRET);
    expect(status).toBe(400);
  });

  it('enforces the global RL_REVALIDATE_MIN rate limit (60/min) across all callers', async () => {
    // Exhaust the global bucket, then confirm the very next authorized call is 429.
    for (let i = 0; i < 60; i++) {
      const { status } = await post({ paths: ['/q'] }, SECRET);
      expect(status).toBe(200);
    }
    const res = await post({ paths: ['/q'] }, SECRET);
    expect(res.status).toBe(429);
  });
});
