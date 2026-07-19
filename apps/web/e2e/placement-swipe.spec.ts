import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * SW6-T1 · Placement-as-a-swipe end-to-end (swipe-ux-plan §2.10). Drives the network-free gallery
 * demo (`/dev/ui`, `gallery-placement-swipe`), which wires `PlacementSwipeCard` to a local
 * `onPick` — so the drag→commit gesture and the D-SW9 axis run with no API/DB. The data-backed
 * 5-item flow on `/placement` (flag-off tap buttons) is covered by `placement.spec.ts`; this pins
 * the swipe mechanics and that the tap wells stay an always-present accessible fallback.
 *
 * `scrollIntoViewIfNeeded()` before every drag is load-bearing, not incidental: this card sits far
 * down the long gallery page, and `page.mouse.move()` takes RAW viewport coordinates and never
 * auto-scrolls (unlike `.click()`), so an off-screen card would silently receive zero pointer
 * events. Product `/placement` renders the card near the top, so it isn't affected there.
 */
async function dragCard(page: Page, card: Locator, dxRatio: number): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  if (!b) throw new Error('placement card has no bounding box');
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

test.describe('SW6-T1 placement swipe', () => {
  let card: Locator;
  let demo: Locator;
  let result: Locator;

  test.beforeEach(async ({ page }) => {
    // Fresh load each test — the demo latches the first pick into its result line (no undo), so a
    // reload is how we reset to the un-called state.
    await page.goto('/dev/ui');
    demo = page.getByTestId('gallery-placement-swipe');
    card = demo.getByTestId('placement-card');
    result = demo.getByTestId('placement-demo-result');
    await card.waitFor();
  });

  test('releasing before the 36% threshold does not commit (no accidental calls)', async ({
    page,
  }) => {
    await dragCard(page, card, 0.2);
    await expect(result).toHaveText('swipe or tap to call it');
  });

  test('dragging right past the threshold calls the FOR side (yes)', async ({ page }) => {
    await dragCard(page, card, 0.6);
    await expect(result).toHaveText('called: yes');
  });

  test('dragging left past the threshold calls the AGAINST side (D-SW9 axis: left = against)', async ({
    page,
  }) => {
    await dragCard(page, card, -0.6);
    await expect(result).toHaveText('called: no');
  });

  test('the tap wells are an always-present accessible call path', async () => {
    await demo.getByTestId('placement-pick-no').click();
    await expect(result).toHaveText('called: no');
  });

  test('reduced motion still calls it (transform-free path)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const rmDemo = page.getByTestId('gallery-placement-swipe');
    const rmCard = rmDemo.getByTestId('placement-card');
    await rmCard.waitFor();
    await dragCard(page, rmCard, 0.6);
    await expect(rmDemo.getByTestId('placement-demo-result')).toHaveText('called: yes');
  });
});
