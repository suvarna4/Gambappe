import { expect, test } from '@playwright/test';

/**
 * WS8-T2 e2e coverage (§10.5). Same boundary as `claim-flow.spec.ts`: verifies the UI actually
 * renders and wires up real routes end-to-end (share-token minting hits the real
 * `/api/share/token` route — no DB dependency, see that route's header comment), up to the
 * point where a feature needs either a real rendered card (covered instead by
 * `test/integration/share-cards.test.ts` against real Postgres) or a real native OS share
 * sheet (`navigator.share`, not something a headless run can meaningfully assert on).
 */

test('opening the gallery share sheet shows the dialog with format toggle, preview, and actions', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  const gallery = page.getByTestId('gallery-share-sheet');
  await expect(page.getByTestId('share-sheet')).toHaveCount(0);

  await gallery.getByRole('button', { name: 'Open share sheet' }).click();
  const sheet = page.getByTestId('share-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Share this');

  await expect(sheet.getByTestId('share-format-square')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('share-format-story')).toHaveAttribute('aria-pressed', 'false');
  await expect(sheet.getByTestId('share-preview-image')).toHaveAttribute(
    'src',
    /\/api\/cards\/receipt\/.*format=square/,
  );

  await expect(sheet.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
});

test('toggling to story updates the preview image to the story format', async ({ page }) => {
  await page.goto('/dev/ui');
  const gallery = page.getByTestId('gallery-share-sheet');
  await gallery.getByRole('button', { name: 'Open share sheet' }).click();
  const sheet = page.getByTestId('share-sheet');

  await sheet.getByTestId('share-format-story').click();
  await expect(sheet.getByTestId('share-format-story')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('share-preview-image')).toHaveAttribute(
    'src',
    /\/api\/cards\/receipt\/.*format=story/,
  );
});

test('copy link mints a real share token, copies the page URL, and fires share_completed', async ({
  page,
}) => {
  await page.goto('/dev/ui');

  type EventPayload = { event?: string; props?: Record<string, unknown> };
  // A `const` array (rather than a reassigned `let`) sidesteps TS narrowing a variable only
  // ever written from inside a route-handler closure down to `never` at later read sites.
  const events: EventPayload[] = [];
  await page.route('**/api/v1/events', async (route) => {
    events.push(route.request().postDataJSON() as EventPayload);
    await route.fulfill({ status: 202, body: JSON.stringify({ data: { accepted: true } }) });
  });

  const gallery = page.getByTestId('gallery-share-sheet');
  // ShareSheet mints the share token in a `useEffect` gated on `open` — it fires the instant
  // the sheet mounts, not on the later "Copy link" click. The listener must be armed before the
  // action that opens the sheet, or a fast mint can complete before `waitForResponse` attaches
  // and the test hangs to its timeout under load.
  const mintResponse = page.waitForResponse('**/api/share/token');
  await gallery.getByRole('button', { name: 'Open share sheet' }).click();
  const sheet = page.getByTestId('share-sheet');
  const mint = await mintResponse;
  expect(mint.status()).toBe(200);

  await sheet.getByRole('button', { name: 'Copy link' }).click();
  await expect(sheet.getByRole('button', { name: 'Copied!' })).toBeVisible();
  await expect.poll(() => events.at(-1)?.event).toBe('share_completed');
  expect(events.at(-1)?.props).toMatchObject({ kind: 'receipt', method: 'copy_link', format: 'square' });
});

test('closing the share sheet removes it from the DOM', async ({ page }) => {
  await page.goto('/dev/ui');
  const gallery = page.getByTestId('gallery-share-sheet');
  await gallery.getByRole('button', { name: 'Open share sheet' }).click();
  const sheet = page.getByTestId('share-sheet');
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('share-sheet')).toHaveCount(0);
});
