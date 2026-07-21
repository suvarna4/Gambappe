/**
 * WS23-T1 · Journey 6 (docs/journeys-plan.md §5): the reachability matrix — every room + `/settings`
 * + `/p/[slug]` reachable from `/` in ≤2 taps, holding through the deck open-then-cleared ritual.
 *
 * The bottom tab bar is mounted in the shell on EVERY page (`AppShell`), so each of the five rooms
 * is exactly ONE tap from anywhere — asserted by href, the deterministic, auth-independent signal
 * (navigating the Rivals/You aliases as a signed-out visitor would redirect to `/claim`; see
 * `shell-nav.spec.ts`). The hrefs are the CURRENT `SHELL_ROUTES` values (Rivals still aliases to
 * `/nemesis` on main — WS17-T2 built the `/rivals` hub page but the tab flip is a later line), i.e.
 * exactly what `shell-nav.spec.ts` asserts.
 *
 * `/settings` and `/p/[slug]` are each 2 taps: tap You (bar) → `/you`, then the room's own
 * settings / public-profile link. While the mixed deck has an open card on stage the bar SINKS
 * (D-J6 / D-SW4, `aria-hidden`), but every room stays reachable by href even then; once the stack
 * is cleared the bar returns. Runs on the journeys webServer (swipe_ballot + topic_markets ON).
 */
import { expect, test } from '@playwright/test';
import {
  addSessionCookie,
  connectDb,
  drainDeck,
  pruneExpiredTopics,
  seedClaimedProfileWithSession,
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

/** The five rooms in bar order, each with the route `SHELL_ROUTES` currently sends it to (Rivals
 * still aliases to `/nemesis` — matches `shell-nav.spec.ts`). */
const ROOMS = [
  { key: 'stack', href: '/' },
  { key: 'sweat', href: '/sweat' },
  { key: 'rivals', href: '/nemesis' },
  { key: 'crowd', href: '/crowd' },
  { key: 'you', href: '/you' },
] as const;

test.describe('Journey 6 · reachability matrix (D-J6)', () => {
  test('every room is 1 tap from / (bar mounted), even with the deck open, and returns when cleared', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await context.clearCookies();

    // Two open topic cards → `/` deals the mixed deck with an open card on stage. Prune expired
    // (un-throwable) topics first so the drain can reach `deck-cleared` (see `pruneExpiredTopics`).
    await pruneExpiredTopics(handle.db);
    await seedTopicCard(handle.db, 'Journey 6 — reachability card A');
    await seedTopicCard(handle.db, 'Journey 6 — reachability card B');

    await page.goto('/');
    await expect(page.getByTestId('deck-queue')).toBeVisible();

    // Every room is one tap away by href — true even while the bar is sunk (the href is still in
    // the DOM; `toHaveAttribute` does not require visibility).
    for (const room of ROOMS) {
      await expect(page.getByTestId(`tab-${room.key}`)).toHaveAttribute('href', room.href);
    }
    // While an open card is centered, the bar sinks (D-J6 ritual).
    await expect(page.getByTestId('tab-bar')).toHaveAttribute('aria-hidden', 'true');

    // Clear the stack → the bar returns and every room is still one tap away.
    await drainDeck(page);
    await expect(page.getByTestId('deck-cleared')).toBeVisible();
    await expect(page.getByTestId('tab-bar')).not.toHaveAttribute('aria-hidden', 'true');
    for (const room of ROOMS) {
      await expect(page.getByTestId(`tab-${room.key}`)).toHaveAttribute('href', room.href);
    }
  });

  test('/settings and /p/[slug] are each ≤2 taps from / (via the You room)', async ({
    page,
    context,
  }) => {
    // Tap 1: the You tab (href asserted on `/`). Tap 2: the room's own links.
    const claimed = await seedClaimedProfileWithSession(handle.db);
    await addSessionCookie(context, claimed.sessionToken);

    await page.goto('/');
    await expect(page.getByTestId('tab-you')).toHaveAttribute('href', '/you');

    await page.goto('/you');
    await expect(page.getByTestId('you-claimed')).toBeVisible();
    // /settings — 2nd tap.
    await expect(page.getByTestId('you-settings-link')).toHaveAttribute('href', '/settings');
    // /p/[slug] — 2nd tap.
    await expect(page.getByTestId('you-public-profile-link')).toHaveAttribute(
      'href',
      `/p/${claimed.slug}`,
    );
  });
});
