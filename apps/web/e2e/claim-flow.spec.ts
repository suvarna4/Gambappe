import { expect, test } from '@playwright/test';

/**
 * WS7-T5 smoke coverage. Full OAuth/magic-link completion isn't exercised here (no real Google
 * credentials in this sandbox, and the email provider's "click the emailed link" step happens
 * out of band) — this verifies the UI actually renders and the documented pieces are wired
 * end-to-end up to the point where a real identity provider would take over. See the PR
 * description for what remains unverified beyond this.
 */

test('gallery renders the WS7-T5 claim prompt engine nudge (streak trigger)', async ({ page }) => {
  await page.goto('/dev/ui');

  const promptEngine = page.getByTestId('claim-prompt-engine');
  await expect(promptEngine).toBeVisible();
  // D-J8 (WS21-T1): "Save" wording, not "claim".
  await expect(promptEngine).toContainText(
    'Your streak lives on this device. Save it — free, ten seconds.',
  );
  await expect(promptEngine.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(promptEngine.getByRole('button', { name: 'Not now' })).toBeVisible();
});

test('dismissing the claim prompt engine hides it', async ({ page }) => {
  await page.goto('/dev/ui');
  const promptEngine = page.getByTestId('claim-prompt-engine');
  await expect(promptEngine).toBeVisible();
  await promptEngine.getByRole('button', { name: 'Not now' }).click();
  await expect(promptEngine).toHaveCount(0);
});

test('claim prompt engine "Save" opens the claim sheet on the sign-in step', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  const promptEngine = page.getByTestId('claim-prompt-engine');
  await promptEngine.getByRole('button', { name: 'Save' }).click();

  const sheet = page.getByTestId('claim-sheet');
  await expect(sheet).toBeVisible();
  // No session/ghost cookie in a fresh browser context → GET /me 401s → sign-in phase directly.
  const entry = sheet.getByTestId('claim-entry');
  await expect(entry).toHaveAttribute('data-phase', 'signin');
  // This gallery example doesn't pass `enabledProviders`, so it uses `ClaimEntry`'s own safe
  // default (WS25-T1: `['email']`, not the pre-fix `['google', 'email']`) — this repo's e2e/CI
  // env never sets `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (grepped `playwright.config.ts` and the
  // GitHub Actions workflows), so a real caller here should never offer a Google button the
  // server can't complete either way; the separate ClaimSheet gallery demo below exercises
  // `enabledProviders` explicitly including both google and x.
  await expect(entry.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(entry.getByRole('button', { name: 'Continue with X' })).toHaveCount(0);
  await expect(entry.getByLabel('Continue with email')).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(entry).toContainText('Your picks, results, and rating are public');

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});

test('gallery ClaimSheet demo opens and closes independently', async ({ page }) => {
  await page.goto('/dev/ui');
  const gallery = page.getByTestId('gallery-claim-sheet');
  await expect(page.getByTestId('claim-sheet')).toHaveCount(0);
  await gallery.getByRole('button', { name: 'Open claim sheet' }).click();
  const sheet = page.getByTestId('claim-sheet');
  await expect(sheet).toBeVisible();
  // This demo passes enabledProviders={['google','email','x']} explicitly.
  await expect(sheet.getByRole('button', { name: 'Continue with X' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});

test('/claim renders the sign-in entry point directly when no session exists', async ({ page }) => {
  await page.goto('/claim');
  const entry = page.getByTestId('claim-entry');
  await expect(entry).toHaveAttribute('data-phase', 'signin');
  // WS25-T1: `/claim` correctly computes `enabledProviders` via `getEnabledAuthProviders()`
  // (`app/claim/page.tsx`) — this repo's e2e/CI env never sets `AUTH_GOOGLE_ID`/
  // `AUTH_GOOGLE_SECRET`, so Google is correctly absent here, not a broken button.
  await expect(entry.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(entry.getByLabel('Continue with email')).toBeVisible();
  // D-J8 (WS21-T1): the neutral "SAVE YOUR RECORD" TicketFrame restyle — Save wording, no "claim".
  await expect(page.getByText('SAVE YOUR RECORD')).toBeVisible();
  await expect(entry).toContainText("Nothing to buy. Just don't lose your record.");
  await expect(entry.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('/claim page carries the 18+ footer notice', async ({ page }) => {
  await page.goto('/claim');
  await expect(page.locator('footer')).toContainText('18+');
});

test('/claim?error=Verification shows the expired-link message, not a stale ghost-confirm card', async ({
  page,
}) => {
  // Design-diff follow-up to WS25: auth.ts's `pages: { error: '/claim' }` sends Auth.js sign-in
  // failures here instead of its own generic page. `Verification` is the code for an
  // expired/already-used magic-link token.
  await page.goto('/claim?error=Verification');
  const entry = page.getByTestId('claim-entry');
  await expect(entry).toHaveAttribute('data-phase', 'signin');
  await expect(page.getByTestId('claim-auth-error')).toHaveText(
    'That link expired or was already used. Enter your email again for a fresh one.',
  );
  // Still fully functional — the same retry form as a normal fresh visit.
  await expect(entry.getByLabel('Continue with email')).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('/claim?error=Configuration (rate limit / transport / misc failures) shows the generic retry message', async ({
  page,
}) => {
  await page.goto('/claim?error=Configuration');
  await expect(page.getByTestId('claim-auth-error')).toHaveText(
    'Something went wrong signing you in. Try again.',
  );
});

test('/claim with no ?error= param never shows the auth-error banner', async ({ page }) => {
  await page.goto('/claim');
  await expect(page.getByTestId('claim-auth-error')).toHaveCount(0);
});
