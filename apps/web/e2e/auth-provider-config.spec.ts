import { expect, test } from '@playwright/test';

/**
 * Regression test for a production-breaking bug: `@auth/core`'s Nodemailer provider throws
 * synchronously — unconditionally, on every `auth()` call, since Auth.js v5's lazy config
 * factory re-runs `buildProviders()` per request — if `server` is falsy, even when
 * `sendVerificationRequest` is fully overridden and never reads `provider.server`. Every
 * `ghost+`/`claimed` route calls the real `auth()` via `resolveIdentityFromRequest`
 * (`apps/web/lib/identity-request.ts`), so this previously 500'd on nearly every
 * identity-resolving route in a real (production-mode `next start`) server — even though it
 * was invisible to `vitest`, which can't import `next-auth`-touching modules at all
 * (`identity-request.ts`'s own header comment explains why), and apparently to every other
 * e2e spec so far, none of which exercised a ghost-minting route. This spec exists so that
 * class of regression can't reappear silently again.
 *
 * `POST /questions/:id/picks` is `none -> mints ghost` (§6.2 step 0-2: identity resolution and
 * ghost minting happen before the question lookup), so a syntactically-valid but nonexistent
 * question id still exercises the full real `auth()` call — a crash there would surface as a
 * 500, not the question-lookup's own clean 404.
 */
test('identity resolution on a ghost-minting route does not 500 (real auth() must not throw)', async ({
  request,
}) => {
  const res = await request.post(
    '/api/v1/questions/019f0000-0000-7000-8000-000000000000/picks',
    {
      headers: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
      data: { side: 'yes', age_attested: true },
    },
  );

  expect(res.status(), 'a real auth() throw would surface here as a 500').not.toBe(500);
  const bodyText = await res.text();
  expect(bodyText).not.toContain('Nodemailer');
  expect(bodyText).not.toContain('AuthError');

  // Identity resolution succeeded and reached the ghost-mint step.
  const setCookie = res.headers()['set-cookie'] ?? '';
  expect(setCookie).toContain('rcpt_gid=');

  // The route did reach past identity resolution to the (expected, unrelated) question lookup.
  expect(res.status()).toBe(404);
  const body = (await JSON.parse(bodyText)) as { error?: { code?: string } };
  expect(body.error?.code).toBe('NOT_FOUND');
});
