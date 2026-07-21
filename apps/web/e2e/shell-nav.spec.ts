/**
 * WS17-T1 E2E · the five-room bottom tab bar (D-J6, journeys-plan §5). Asserts: the bar is on
 * every page, each room is reachable from `/` in ≤2 taps (one tap — the bar is always mounted),
 * the active tab tracks the pathname, and the bar sinks while the open-question deck is on stage.
 *
 * Tabs point through `SHELL_ROUTES`, which today maps the not-yet-built rooms onto existing routes
 * (`/sweat`,`/crowd`→`/q`, `/rivals`→`/nemesis`, `/you`→`/settings`); those flip one line each in
 * WS19-T2/WS22-T1/T2/WS17-T2. `/nemesis` is behind the `nemesis` flag, which `playwright.config.ts`
 * defaults on, so the Rivals destination resolves in this lane.
 *
 * The deck-on-stage test needs `swipe_ballot` ON (default off, §4.6) — the deck only goes
 * full-screen on `/`'s open state under that flag. Mirroring `curation-topic.spec.ts`, it's gated
 * on the flag the webServer was booted with so exactly the right assertion runs per lane.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import { etDateString } from '@/lib/ops-dashboard';
import type pg from 'pg';

const SWIPE_BALLOT_ON =
  process.env.FLAG_SWIPE_BALLOT === 'true' || process.env.FLAG_SWIPE_BALLOT === '1';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

/** The rooms in bar order, each with the route `SHELL_ROUTES` currently sends it to. */
const ROOMS = [
  { key: 'stack', href: '/' },
  { key: 'sweat', href: '/q' },
  { key: 'rivals', href: '/nemesis' },
  { key: 'crowd', href: '/q' },
  { key: 'you', href: '/settings' },
] as const;

test.describe('WS17-T1 app shell — bottom tab bar (D-J6)', () => {
  test('the bar mounts on every page (home, and a deep route)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    for (const room of ROOMS) {
      await expect(page.getByTestId(`tab-${room.key}`)).toBeVisible();
    }
    // still there on a non-home route.
    await page.goto('/settings');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  });

  test('every room is reachable from / in ≤2 taps', async ({ page }) => {
    await page.goto('/');
    // The bar is mounted on every page, so every room is exactly one tap away. Assert each tab
    // links to its `SHELL_ROUTES` destination — navigating the Rivals/You aliases (`/nemesis`,
    // `/settings`) as a signed-out visitor redirects to `/claim`, so the reachable href is the
    // deterministic, auth-independent signal that the room is one tap from `/`.
    for (const room of ROOMS) {
      await expect(page.getByTestId(`tab-${room.key}`)).toHaveAttribute('href', room.href);
    }
  });

  test('the active tab tracks the pathname (prefix + alias rules)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-stack')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('tab-rivals')).not.toHaveAttribute('aria-current', 'page');

    // `/q*` is a Stack alias and renders for a signed-out visitor, so Stack stays lit through a
    // full navigation (proving the browser wiring, not just the pure fn). The Rivals/You aliases
    // (`/nemesis*`, `/settings`) redirect a ghost to `/claim`, so they can't be exercised
    // anonymously here — every alias rule is covered directly in `resolveActiveTab`'s unit table
    // (test/app-shell.test.tsx).
    await page.goto('/q');
    await expect(page.getByTestId('tab-stack')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('tab-you')).not.toHaveAttribute('aria-current', 'page');
  });

  test('the bar stays put on / when no open-question deck is on stage', async ({ page }) => {
    await page.goto('/');
    // flag-off (default lane): no full-screen deck, so the bar is live, not sunk.
    await expect(page.getByTestId('tab-bar')).not.toHaveAttribute('aria-hidden', 'true');
  });

  test.describe('deck on stage (swipe_ballot ON)', () => {
    test.skip(!SWIPE_BALLOT_ON, 'swipe_ballot is off in this lane (§4.6 default)');

    test('the bar sinks while today’s open question is full-screen on /', async ({ page }) => {
      const unique = randomUUID();
      const market = buildMarket({ venueMarketId: `KX-SHELL-${unique}` });
      await db.insert(markets).values(market);
      const now = Date.now();
      const question = buildQuestion(market.id as string, {
        slug: `shell-${unique}`,
        questionDate: etDateString(new Date(now)),
        status: 'open',
        openAt: new Date(now - 3_600_000),
        lockAt: new Date(now + 3_600_000),
      });
      await db.insert(questions).values(question);

      await page.goto('/');
      // the open-question deck is on stage…
      await expect(page.getByTestId('deck-stage')).toBeVisible();
      // …so the bar is aria-hidden and translated below the viewport (D-J6 / D-SW4).
      await expect(page.getByTestId('tab-bar')).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
