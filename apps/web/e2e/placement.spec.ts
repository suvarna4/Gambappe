import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * WS7-T10 AC (design doc §19.3): "5-tap flow with per-item mini-reveals". Network calls to
 * the already-shipped WS4-T8 endpoints are mocked at the browser/CDP layer (`page.route`) so
 * this spec is deterministic and needs no seeded DB state — it exercises the PAGE's state
 * machine (5 items in sequence, one mini-reveal per answer, completion screen), not the API
 * itself. The real API round-trip is verified separately (see this task's PR description /
 * report for the manual `curl` + live-server pass against a seeded Postgres).
 */

interface MockItem {
  id: string;
  title: string;
  category: string;
  yes_label: string;
  no_label: string;
  outcome: 'yes' | 'no';
  historical_yes_price: number;
  historical_crowd_yes_pct: number;
  resolved_on: string;
}

const ITEMS: MockItem[] = [
  {
    id: randomUUID(),
    title: 'Did the favorite win the 2024 title game?',
    category: 'sports',
    yes_label: 'Favorite won',
    no_label: 'Underdog won',
    outcome: 'yes',
    historical_yes_price: 0.62,
    historical_crowd_yes_pct: 71,
    resolved_on: '2024-01-15',
  },
  {
    id: randomUUID(),
    title: 'Did turnout exceed 60%?',
    category: 'politics',
    yes_label: 'Over 60%',
    no_label: 'Under 60%',
    outcome: 'no',
    historical_yes_price: 0.55,
    historical_crowd_yes_pct: 64,
    resolved_on: '2024-02-20',
  },
  {
    id: randomUUID(),
    title: 'Was a recession declared?',
    category: 'economics',
    yes_label: 'Recession',
    no_label: 'No recession',
    outcome: 'no',
    historical_yes_price: 0.3,
    historical_crowd_yes_pct: 41,
    resolved_on: '2024-03-10',
  },
  {
    id: randomUUID(),
    title: 'Did a debut artist top the chart?',
    category: 'culture',
    yes_label: 'Debut artist',
    no_label: 'Established artist',
    outcome: 'no',
    historical_yes_price: 0.18,
    historical_crowd_yes_pct: 25,
    resolved_on: '2024-04-05',
  },
  {
    id: randomUUID(),
    title: 'Did a lunar lander touch down intact?',
    category: 'science',
    yes_label: 'Intact landing',
    no_label: 'No intact landing',
    outcome: 'yes',
    historical_yes_price: 0.45,
    historical_crowd_yes_pct: 52,
    resolved_on: '2024-05-01',
  },
];

test('WS7-T10 placement: 5-tap flow with per-item mini-reveals', async ({ page }) => {
  const answeredItemIds: string[] = [];

  await page.route('**/api/v1/placement', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: ITEMS.map(({ id, title, category, yes_label, no_label }) => ({
            id,
            title,
            category,
            yes_label,
            no_label,
          })),
        },
      }),
    });
  });

  await page.route('**/api/v1/placement/answers', async (route) => {
    const body = route.request().postDataJSON() as { item_id: string; side: 'yes' | 'no' };
    const item = ITEMS.find((i) => i.id === body.item_id);
    if (!item) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'placement item not found' } }),
      });
      return;
    }
    answeredItemIds.push(item.id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          item_id: item.id,
          side: body.side,
          outcome: item.outcome,
          correct: body.side === item.outcome,
          historical_yes_price: item.historical_yes_price,
          historical_crowd_yes_pct: item.historical_crowd_yes_pct,
          resolved_on: item.resolved_on,
        },
      }),
    });
  });

  await page.route('**/api/v1/events', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ data: { accepted: true } }),
    });
  });

  await page.goto('/placement');

  for (let i = 0; i < ITEMS.length; i++) {
    const item = ITEMS[i]!;
    const isLast = i === ITEMS.length - 1;

    await expect(page.getByTestId('placement-progress')).toHaveText(`Item ${i + 1} of 5`);
    await expect(page.getByTestId('placement-flow')).toContainText(item.title);

    // Pick buttons visible, no mini-reveal yet — one tap per item, not a pre-filled state.
    await expect(page.getByTestId('placement-mini-reveal')).toHaveCount(0);
    await page.getByRole('button', { name: item.yes_label, exact: true }).click();

    // The tap's own response renders an immediate mini-reveal — before advancing.
    const reveal = page.getByTestId('placement-mini-reveal');
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText(item.outcome === 'yes' ? 'WIN' : 'LOSS');
    await expect(reveal).toContainText(item.resolved_on);
    // Crowd comparison + historical price are both part of the per-item mini-reveal (§8.7).
    await expect(reveal.getByRole('img')).toHaveAttribute(
      'aria-label',
      // D-SW9 (SW2-T3): CrowdBar's aria-label reads in visual axis order — NO first.
      new RegExp(`Crowd split: ${item.no_label} \\d+%, ${item.yes_label} \\d+%`),
    );

    // Still on the same item (advancing is a separate, deliberate tap).
    await expect(page.getByTestId('placement-progress')).toHaveText(`Item ${i + 1} of 5`);

    await page.getByRole('button', { name: isLast ? 'See your results' : 'Next' }).click();
  }

  expect(answeredItemIds).toEqual(ITEMS.map((i) => i.id));

  await expect(page.getByTestId('placement-complete')).toBeVisible();
  await expect(page.getByTestId('placement-complete')).toContainText(
    'Your starting profile is ready',
  );
  // The test always taps each item's yes_label; outcomes are yes, no, no, no, yes → 2/5 correct.
  await expect(page.getByTestId('placement-complete')).toContainText('You called 2 of 5 right');
  await expect(page.getByRole('link', { name: "Go to today's question" })).toHaveAttribute(
    'href',
    '/',
  );
});

test('WS7-T10 placement: UNAUTHENTICATED GET falls back to a CTA instead of crashing', async ({
  page,
}) => {
  // §6.1.1: GET /placement never lazily mints a ghost — a cold visitor with no identity yet
  // gets UNAUTHENTICATED (SPEC-GAP noted in PlacementClient.tsx). The page must degrade
  // gracefully, not show a raw error or a blank screen.
  await page.route('**/api/v1/placement', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: 'a ghost or claimed profile is required' },
      }),
    });
  });

  await page.goto('/placement');

  await expect(page.getByRole('heading', { name: 'Make a pick first' })).toBeVisible();
  await expect(page.getByRole('link', { name: "Go to today's question" })).toHaveAttribute(
    'href',
    '/',
  );
});
