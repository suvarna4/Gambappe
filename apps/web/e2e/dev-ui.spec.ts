import { expect, test } from '@playwright/test';

test('WS7-T1 design system gallery renders every component state', async ({ page }) => {
  await page.goto('/dev/ui');

  await expect(page.getByTestId('gallery-ticketcard')).toBeVisible();
  await expect(page.getByTestId('gallery-ticketcard')).toContainText('France');

  const stamps = page.getByTestId('gallery-stamp');
  await expect(stamps).toContainText('WIN');
  await expect(stamps).toContainText('LOSS');
  await expect(stamps).toContainText('VOID');
  await expect(stamps).toContainText('CALLED IT');
  await expect(stamps).toContainText('PENDING');

  // SW3-T2 (§2.7 "four inks"): `called_it` defaults to foil, `void` defaults to punch — both
  // already rendered in the section above; this checks the ink actually reached the DOM.
  await expect(stamps.locator('[data-ink="foil"]')).toContainText('CALLED IT');
  await expect(stamps.locator('[data-ink="punch"]')).toContainText('VOID');

  const stampInks = page.getByTestId('gallery-stamp-ink');
  await expect(stampInks.locator('[data-ink="rubber"]')).toBeVisible();
  await expect(stampInks.locator('[data-ink="tape"]')).toBeVisible();
  await expect(stampInks.locator('[data-ink="punch"]')).toBeVisible();

  const priceTags = page.getByTestId('gallery-pricetag');
  await expect(priceTags).toContainText('63¢');
  await expect(priceTags).toContainText('98¢');

  const crowdBars = page.getByTestId('gallery-crowdbar');
  // D-SW9 (SW2-T3): CrowdBar is axis-ordered NO-left/YES-right; its aria-label reads in the
  // same visual order.
  await expect(crowdBars.getByRole('img').first()).toHaveAttribute(
    'aria-label',
    /Crowd split: Brazil 30%, France 70%/,
  );

  await expect(page.getByTestId('gallery-countdown')).toContainText('Locks in');
  await expect(page.getByTestId('gallery-countdown')).toContainText('Locked');

  const streaks = page.getByTestId('gallery-streakflame');
  await expect(streaks).toContainText('🔥');
  await expect(streaks).toContainText('❄️');

  await expect(page.getByTestId('gallery-barcode')).toContainText('/q/2026-07-19-world-cup-final');

  // WS19-T2: the SweatRow tile renders its sample positions with settle-when labels + drift.
  const sweat = page.getByTestId('gallery-sweatrow');
  await expect(sweat).toContainText('LIVE');
  await expect(sweat).toContainText('~NOV 2026');
  await expect(sweat.getByTestId('sweat-row').first()).toBeVisible();

  // WS24-T1 (STRETCH): the FlapText primitive renders one accessible reading per string (its
  // decorative cells are aria-hidden), and the departures-board tile lays the same sample
  // positions out as an arrivals board with per-row STATUS flaps.
  const flap = page.getByTestId('gallery-flaptext');
  await expect(flap).toContainText('LIVE');
  await expect(flap).toContainText('71¢');

  const board = page.getByTestId('gallery-departures-board');
  await expect(board.getByTestId('departures-board')).toBeVisible();
  await expect(board.getByTestId('departures-row')).toHaveCount(3);
  await expect(board).toContainText('DEPARTURES');
  await expect(board).toContainText('LIVE');
});
