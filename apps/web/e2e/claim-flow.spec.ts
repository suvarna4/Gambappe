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
  // This gallery example doesn't pass `enabledProviders`, so it uses the documented default
  // (§11.1: "V1 may ship email+Google only") — no X button here; the separate ClaimSheet gallery
  // demo below exercises `enabledProviders` including X.
  await expect(entry.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
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
  await expect(entry.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
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
