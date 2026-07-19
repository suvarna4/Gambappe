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
});
