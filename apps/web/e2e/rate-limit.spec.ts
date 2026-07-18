import { expect, test } from '@playwright/test';

/**
 * WS11-T1: POST /api/v1/events is rate-limited at 120/hour per IP (§14.1 RL_EVENTS_IP_H).
 * Uses a random per-run `x-forwarded-for` so this test never shares a bucket with another
 * run (or with the manual curl testing done during development) — no cleanup needed.
 */
test('POST /api/v1/events 429s with Retry-After once the per-IP limit is exceeded', async ({
  request,
}) => {
  const fakeIp = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(
    Math.random() * 255,
  )}`;
  const headers = { 'x-forwarded-for': fakeIp, 'content-type': 'application/json' };
  const body = JSON.stringify({ event: 'spectator_view', props: {} });

  for (let i = 0; i < 120; i++) {
    const res = await request.post('/api/v1/events', { headers, data: body });
    expect(res.status(), `request ${i + 1} should still be under the limit`).toBe(202);
  }

  const limited = await request.post('/api/v1/events', { headers, data: body });
  expect(limited.status()).toBe(429);
  const retryAfter = Number(limited.headers()['retry-after']);
  expect(retryAfter).toBeGreaterThan(0);
});
