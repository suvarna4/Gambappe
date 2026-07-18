import { expect, test } from '@playwright/test';

test('GET /api/health reports pg + redis ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string; checks: Record<string, string> };
  expect(body.status).toBe('ok');
  expect(body.checks.postgres).toBe('ok');
  expect(body.checks.redis).toBe('ok');
  expect(res.headers()['x-server-time']).toMatch(/^\d+$/);
});

test('home page renders with the 18+ footer (INV-9)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible();
  await expect(page.locator('footer')).toContainText('18+');
});
