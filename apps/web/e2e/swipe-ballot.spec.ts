import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * SW1-T5 · Swipe-ballot end-to-end (the runtime verification deferred from SW1-T2's unit tests).
 * Drives the interactive gallery demo (`/dev/ui`, `gallery-swipeballot`) — it uses a local fake
 * pick with no API/DB, so the full drag→arm→commit→receipt→undo loop runs anywhere the browser
 * does. The data-backed flow on `/` (POST + server-stamped price) is covered by the golden-loop
 * spec; this pins the gesture mechanics and the D-SW9 axis (right = for, left = against).
 */
async function dragCard(page: Page, card: Locator, dxRatio: number): Promise<void> {
  // `page.mouse.move()` takes raw viewport coordinates and never auto-scrolls (unlike `.click()`),
  // so the card must be in view first — it sits below the fold on the long gallery page at the
  // Desktop-Chrome 720px height, and an off-screen card silently receives zero pointer events.
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  if (!b) throw new Error('card has no bounding box');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const target = cx + b.width * dxRatio;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx + (target - cx) * (i / 12), cy);
  }
  await page.mouse.up();
}

test.describe('SW1-T5 swipe ballot', () => {
  let card: Locator;
  let demo: Locator;

  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    demo = page.getByTestId('gallery-swipeballot');
    card = demo.getByTestId('ballot-card-interactive');
    await card.waitFor();
  });

  test('releasing before the 36% threshold does not commit (no accidental picks)', async ({
    page,
  }) => {
    await dragCard(page, card, 0.2);
    await expect(demo.getByTestId('receipt-slip')).toHaveCount(0);
  });

  test('dragging right past the threshold commits the FOR side and prints the receipt', async ({
    page,
  }) => {
    await dragCard(page, card, 0.6);
    const receipt = demo.getByTestId('receipt-slip');
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('CUTS'); // yes_label = for
  });

  test('dragging left past the threshold commits the AGAINST side (D-SW9 axis)', async ({
    page,
  }) => {
    await dragCard(page, card, -0.6);
    await expect(demo.getByTestId('receipt-slip')).toContainText('HOLDS'); // no_label = against
  });

  test('undo retracts the receipt and returns the card', async ({ page }) => {
    await dragCard(page, card, 0.6);
    await expect(demo.getByTestId('receipt-slip')).toBeVisible();
    await demo.getByTestId('undo-pick').click();
    await expect(demo.getByTestId('receipt-slip')).toHaveCount(0);
    await expect(card).toBeVisible();
  });

  test('the tap wells are an always-present accessible pick path', async () => {
    await demo.getByTestId('pick-yes').click();
    await expect(demo.getByTestId('receipt-slip')).toContainText('CUTS');
  });

  test('design-diff audit: the peeking next-day card shows behind the printed receipt', async ({
    page,
  }) => {
    // `SwipeBallotGalleryDemo` wires a fixed `tomorrowPeek` fixture (no live API call) — see that
    // file's header — so committing a pick should surface the real-data peek label, not the flat
    // banner. §2.5 pins the label verbatim (headline stays hidden): "TOMORROW · opens {time}".
    await demo.getByTestId('pick-yes').click();
    await expect(demo.getByTestId('receipt-slip')).toBeVisible();
    await expect(page.getByText(/^TOMORROW · opens/)).toBeVisible();
  });

  test('reduced motion still commits (transform-free path)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const rmDemo = page.getByTestId('gallery-swipeballot');
    const rmCard = rmDemo.getByTestId('ballot-card-interactive');
    await rmCard.waitFor();
    await dragCard(page, rmCard, 0.6);
    await expect(rmDemo.getByTestId('receipt-slip')).toBeVisible();
  });
});
