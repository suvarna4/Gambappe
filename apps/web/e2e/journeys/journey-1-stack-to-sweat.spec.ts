/**
 * WS23-T1 · Journey 1 (docs/journeys-plan.md §5): a fresh visitor lands on `/`, works the single
 * mixed stack deck — throws cards, skips one (which re-enqueues, never a pick) — reaches
 * end-of-stack, and the thrown picks surface as open positions on `/sweat`.
 *
 * Runs on the `journeys` project (webServer flags: swipe_ballot + topic_markets ON), so `/` renders
 * the DeckQueue (D-J2). The CI-seeded DB has NO `kind='daily'` "today" row (`packages/db/scripts/
 * seed.ts` seeds only users/seasons/placement items), and the house rules forbid a spec seeding its
 * own daily at ET-today — so the feed's headliner is null and the deck deals ONLY this spec's
 * `kind='topic'` cards (no daily-date uniqueness). The lead card is therefore a topic acting as the
 * headliner; the throw → skip → end-of-stack ritual is exercised identically. `departures_board`
 * stays OFF for the gate, so `/sweat` renders the WS19-T2 paper `sweat-row` list (the surface the
 * gate's flag set produces).
 *
 * Determinism: the viewer is a BRAND-NEW visitor (no cookie); the ghost identity is minted
 * server-side on the first thrown pick, so the only `pending` picks that exist for it afterward are
 * the ones this deck committed — the `/sweat` count is exactly the number of throws.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  connectDb,
  drainDeck,
  pruneExpiredTopics,
  seedTopicCard,
  type DbHandle,
} from './_journey-helpers';

let handle: DbHandle;

test.beforeAll(() => {
  handle = connectDb();
});

test.afterAll(async () => {
  await handle.pool.end();
});

test.describe('Journey 1 · stack deck → /sweat (D-J2/D-J3)', () => {
  test('throw, skip, end-of-stack → thrown cards surface as open positions on /sweat', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await context.clearCookies();

    // The `/` deck is viewer-free (INV-10) → it deals every open topic card in the shared DB (capped
    // 8), and stale cards accumulate across runs, so neither an exact deck size nor "MY specific
    // cards were dealt" is deterministic. What IS deterministic (and is the load-bearing thing a
    // fresh visitor cares about): every card they THREW becomes one of their positions on `/sweat`
    // (`sweat-row` count == throws). Prune expired (un-throwable) topics first so the drain can
    // reach `deck-cleared`, and seed two guaranteed-throwable cards so the deck has >= 2 to throw.
    await pruneExpiredTopics(handle.db);
    const tag = randomUUID().slice(0, 8);
    await seedTopicCard(handle.db, `Journey 1 first card ${tag}`);
    await seedTopicCard(handle.db, `Journey 1 second card ${tag}`);

    // --- land on / : the mixed stack deck is dealt --------------------------------------------
    await page.goto('/');
    await expect(page.getByTestId('deck-queue')).toBeVisible();
    await expect(page.getByTestId('deck-progress')).toHaveText(/\d+ of \d+/i);
    await expect(page.getByTestId('ballot-card-interactive').first()).toBeVisible();

    // --- skip the top card (ArrowUp) : it re-enqueues at the back and NEVER hits the pick API --
    let pickPosts = 0;
    await page.route('**/api/v1/questions/*/picks', (route) => {
      if (route.request().method() === 'POST') pickPosts += 1;
      return route.continue();
    });
    const topBefore = await page.getByTestId('ballot-card-interactive').first().innerText();
    await page.getByTestId('pick-yes').first().focus();
    await page.keyboard.press('ArrowUp');
    await expect
      .poll(async () => page.getByTestId('ballot-card-interactive').first().innerText())
      .not.toBe(topBefore);
    expect(pickPosts, 'a skip must never POST a pick (D-J2)').toBe(0);

    // --- throw every remaining card (a well tap = a real, price-stamped pick) → end-of-stack ---
    const throws = await drainDeck(page);
    expect(throws, 'the deck should have dealt at least the two seeded cards').toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('deck-cleared')).toBeVisible();
    await expect(page.getByTestId('deck-cleared')).toContainText('Stack cleared');
    await expect(page.getByTestId('deck-sweat-link')).toHaveAttribute('href', '/sweat');

    // --- /sweat shows the thrown positions ----------------------------------------------------
    // This is a brand-new visitor (cookies cleared) whose ghost was minted on the first throw, so
    // its ONLY positions are the cards it just threw — the row count reflects those throws.
    await page.goto('/sweat');
    await expect(page.getByTestId('sweat-list')).toBeVisible();
    const rowCount = await page.getByTestId('sweat-row').count();
    expect(rowCount, 'every thrown card surfaces as an open position').toBeGreaterThanOrEqual(2);
  });
});
