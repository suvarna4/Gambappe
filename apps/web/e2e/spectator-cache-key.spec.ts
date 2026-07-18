import { expect, test } from '@playwright/test';

/**
 * WS8-T3 (design doc §10.2, INV-10): "The CDN/ISR cache key for public routes must ignore
 * all cookies (a returning ghost's `rcpt_gid` must not fragment the cache — WS8-T3 has an
 * explicit test asserting identical cache behavior with and without the cookie."
 *
 * This is the real-HTTP half of that proof (the structural half — the page's data loader
 * takes no request/cookie parameter at all — is
 * `test/integration/spectator-question-page.test.ts`). It runs the 404 branch rather than a
 * seeded found-question, because e2e here boots a production `next start` against whatever
 * `DATABASE_URL` the runner provides (no fixture-seeding hook in `playwright.config.ts` at
 * P0) — but the found-branch is served by literally the same route handler and the same
 * cookie-free loader, so a 404 response differing (or not) by cookie presence is exactly as
 * diagnostic: if request cookies could ever leak into this route's output, they'd show up
 * here as readily as anywhere.
 *
 * NOTE: not executable in this sandbox (no Playwright browser binaries available, no
 * `pnpm exec playwright install` network access) — written and reviewed against the
 * existing e2e conventions (`rate-limit.spec.ts`, `health.spec.ts`) but unverified locally.
 * First real run should be CI.
 */
test('GET /q/:slug is byte-identical with and without a ghost cookie present (§10.2)', async ({
  request,
}) => {
  const slug = 'e2e-cache-key-nonexistent-slug';

  const withoutCookie = await request.get(`/q/${slug}`, {
    headers: { cookie: '' },
  });
  const withCookie = await request.get(`/q/${slug}`, {
    headers: { cookie: 'rcpt_gid=deadbeef-0000-0000-0000-000000000000' },
  });

  const [bodyWithoutCookie, bodyWithCookie] = await Promise.all([
    withoutCookie.text(),
    withCookie.text(),
  ]);

  expect(withoutCookie.status()).toBe(withCookie.status());
  expect(bodyWithoutCookie).toBe(bodyWithCookie);

  // The response itself must never echo the cookie back (belt-and-suspenders — the loader
  // has no way to see it, but assert the observable contract directly too).
  expect(bodyWithCookie).not.toContain('deadbeef-0000-0000-0000-000000000000');
});
