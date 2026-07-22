/**
 * Home topic filter (D-J2 supply): the `/` stack gained a topic filter row that actually changes
 * the dealt cards. Toggling a chip persists a follow (`POST /api/v1/topics/:category/follow`) and
 * then the deck refetches `GET /api/v1/stack` and re-deals. This pins the WIRING — the follow write
 * AND the stack refetch both fire on a toggle — rather than the exact dealt set, so it stays robust
 * against the other journeys' shared-DB topic seeding (no prune race, no cross-test dependency).
 *
 * Runs on the `journeys` project (swipe_ballot + topic_markets ON), so `/` renders the `StackDeck`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connectDb, seedTopicCard, type DbHandle } from './_journey-helpers';

let handle: DbHandle;

test.beforeAll(() => {
  handle = connectDb();
});

test.afterAll(async () => {
  await handle.pool.end();
});

test.describe('Home topic filter · chip toggle re-deals the stack (D-J2)', () => {
  test('toggling a topic chip persists a follow and refetches the stack feed', async ({
    page,
    context,
  }) => {
    test.setTimeout(45_000);
    await context.clearCookies();

    // Seed one open topic so `/`'s all-categories deck is non-empty regardless of what the other
    // journeys have pruned/seeded (this test asserts the filter WIRING, not the dealt set).
    await seedTopicCard(handle.db, `Journey 7 filter card ${randomUUID().slice(0, 8)}`);

    await page.goto('/');
    await expect(page.getByTestId('stack-deck')).toBeVisible();
    await expect(page.getByTestId('topic-follow-chips')).toBeVisible();
    // The deck is dealt and the single instruction line is present (no rails / duplicate hints).
    await expect(page.getByTestId('deck-progress')).toHaveText(/\d+ of \d+/i);
    await expect(page.getByTestId('rail-against')).toHaveCount(0);
    await expect(page.getByTestId('ballot-hints')).toHaveCount(0);

    // Watch the two calls the toggle must make: the follow write + the stack refetch.
    const followPost = page.waitForRequest(
      (r) => /\/api\/v1\/topics\/sports\/follow$/.test(r.url()) && r.method() === 'POST',
    );
    const stackRefetch = page.waitForRequest(
      (r) => /\/api\/v1\/stack$/.test(r.url()) && r.method() === 'GET',
    );

    await page.getByTestId('topic-chip-sports').click();

    await followPost;
    await stackRefetch;

    // The chip reflects the followed state. (We assert the wiring, not the re-dealt set: filtering
    // to a category the shared DB may have no open cards in can legitimately empty the deck.)
    await expect(page.getByTestId('topic-chip-sports')).toHaveAttribute('aria-pressed', 'true');
    // The deck stays in a valid rendered state (dealt, cleared, or empty) — never a crash.
    await expect(
      page
        .getByTestId('deck-progress')
        .or(page.getByTestId('deck-cleared'))
        .or(page.getByTestId('no-question-today')),
    ).toBeVisible();
  });
});
