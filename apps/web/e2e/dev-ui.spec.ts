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
  await expect(crowdBars.getByRole('img').first()).toHaveAttribute(
    'aria-label',
    /Crowd split: France 70%, Brazil 30%/,
  );

  await expect(page.getByTestId('gallery-countdown')).toContainText('Locks in');
  await expect(page.getByTestId('gallery-countdown')).toContainText('Locked');

  const streaks = page.getByTestId('gallery-streakflame');
  await expect(streaks).toContainText('🔥');
  await expect(streaks).toContainText('❄️');

  await expect(page.getByTestId('gallery-barcode')).toContainText('/q/2026-07-19-world-cup-final');
});
