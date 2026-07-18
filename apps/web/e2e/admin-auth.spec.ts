import { expect, test } from '@playwright/test';

/**
 * WS10-T1 AC: non-admin/no-token requests 404 (not 401/403 — the existence of `/admin`
 * isn't acknowledged). Requires ADMIN_STOPGAP_TOKEN + ADMIN_STOPGAP_IP_ALLOWLIST set to
 * match this suite's requests (see playwright.config.ts webServer env).
 */
const TOKEN = 'e2e-test-stopgap-token';
const ALLOWED_IP = '127.0.0.1';

test('no token → 404', async ({ request }) => {
  const res = await request.get('/admin');
  expect(res.status()).toBe(404);
});

test('wrong token → 404', async ({ request }) => {
  const res = await request.get('/admin', {
    headers: { authorization: 'Bearer wrong-token' },
  });
  expect(res.status()).toBe(404);
});

test('right token from a disallowed IP → 404', async ({ request }) => {
  const res = await request.get('/admin', {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': '9.9.9.9' },
  });
  expect(res.status()).toBe(404);
});

test('right token from the allowed IP → 200, renders the shell', async ({ request }) => {
  const res = await request.get('/admin', {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': ALLOWED_IP },
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Receipts admin');
});

test('/api/admin/* is gated the same way', async ({ request }) => {
  const denied = await request.get('/api/admin/audit-log');
  expect(denied.status()).toBe(404);

  const allowed = await request.get('/api/admin/audit-log', {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': ALLOWED_IP },
  });
  expect(allowed.status()).toBe(200);
  const body = (await allowed.json()) as { data: unknown[] };
  expect(Array.isArray(body.data)).toBe(true);
});
