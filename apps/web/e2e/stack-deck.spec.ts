/**
 * WS18-T3 · The single mixed stack deck on `/` (journeys plan §5, D-J2). Two flag-aware halves,
 * exactly like `curation-topic.spec.ts`: the deck flow runs only when the server was booted with
 * BOTH `swipe_ballot` and `topic_markets` ON (the mixed stack needs the swipe deck AND topic
 * supply); the flag-off regression runs otherwise and proves `/` is unchanged from today.
 *
 * The queue math (throw removes / skip re-enqueues at the back / skip never marks a pick) has
 * exhaustive pure-reducer coverage in `test/deck-queue.test.ts`; this spec pins the browser wiring:
 * the deck renders, the up-key/up-swipe skip works and never hits the pick API, throwing advances
 * to the cleared state, and — the AC regression — the deck does NOT render with the flag off.
 *
 * Topic cards are seeded through the real admin publish route (kind='topic', no date uniqueness),
 * the same wiring `curation-topic.spec.ts` uses. The daily HEADLINER is whatever today's real
 * `kind='daily'` row is (globally unique — a spec can't seed its own "today", see
 * `golden-loop.spec.ts`), so assertions here key off the seeded TOPIC cards and tolerate the
 * headliner being present-or-absent.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { connect, markets, type Db } from '@receipts/db';
import { buildMarket } from '@receipts/db/testing';
import type pg from 'pg';

const TOKEN = 'e2e-test-stopgap-token';
const ALLOWED_IP = '127.0.0.1';
const flagOn = (v: string | undefined) => v === 'true' || v === '1';
const SWIPE_ON = flagOn(process.env.FLAG_SWIPE_BALLOT);
const TOPIC_ON = flagOn(process.env.FLAG_TOPIC_MARKETS);
/** The mixed stack deck only replaces the single-question render when BOTH flags are on. */
const STACK_ON = SWIPE_ON && TOPIC_ON;

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

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': ALLOWED_IP, ...extra };
}

/** Seed an open market + publish a `kind='topic'` question off it → it lands in the stack feed. */
async function publishTopic(request: APIRequestContext, headline: string): Promise<string> {
  const unique = randomUUID().slice(0, 8);
  const market = buildMarket({
    venueMarketId: `kx-stack-e2e-${unique}`,
    category: 'economics',
    status: 'open',
    closeTime: new Date(Date.now() + 30 * 24 * 3600_000),
  });
  await db.insert(markets).values(market);
  const publish = await request.post(`/api/admin/markets/${market.id}/topic-question`, {
    headers: adminHeaders({ 'content-type': 'application/json' }),
    data: { headline, yes_label: 'Cut', no_label: 'Hold' },
  });
  expect(publish.status()).toBe(201);
  const created = (await publish.json()) as { data: { slug: string } };
  return created.data.slug;
}

test.describe('WS18-T3 stack deck (flags on)', () => {
  test.skip(!STACK_ON, 'swipe_ballot + topic_markets are not both on in this environment');

  test('deals a mixed stack with an "N of M" progress chip', async ({ page, request }) => {
    await publishTopic(request, 'Will the Fed cut rates this quarter?');
    await publishTopic(request, 'Will inflation print below target?');

    await page.goto('/');
    await expect(page.getByTestId('deck-queue')).toBeVisible();
    // At least the two seeded topics (+ maybe today's headliner) are dealt.
    await expect(page.getByTestId('deck-progress')).toHaveText(/\d+ of \d+/i);
    // A topic card is open, so the interactive ballot is on stage.
    await expect(page.getByTestId('ballot-card-interactive').first()).toBeVisible();
  });

  test('skip (ArrowUp) re-enqueues at the back and NEVER hits the pick API', async ({
    page,
    request,
  }) => {
    await publishTopic(request, 'Skip me — economics topic A');
    await publishTopic(request, 'Skip me — economics topic B');

    // Fail loudly if a skip ever POSTs a pick (the core D-J2 guarantee).
    let pickPosts = 0;
    await page.route('**/api/v1/questions/*/picks', (route) => {
      if (route.request().method() === 'POST') pickPosts += 1;
      return route.continue();
    });

    await page.goto('/');
    await expect(page.getByTestId('deck-queue')).toBeVisible();

    const topBefore = await page.getByTestId('ballot-card-interactive').first().innerText();
    // Keyboard skip parity (docs/a11y-swipe-ux.md): focus a well and press ArrowUp.
    await page.getByTestId('pick-yes').first().focus();
    await page.keyboard.press('ArrowUp');

    // The card on stage changes (the skipped card went to the back), and no pick was recorded.
    await expect
      .poll(async () => page.getByTestId('ballot-card-interactive').first().innerText())
      .not.toBe(topBefore);
    expect(pickPosts).toBe(0);
  });

  test('throwing every card clears the stack and links to /sweat', async ({ page, request }) => {
    await publishTopic(request, 'Throw me — topic one');
    await publishTopic(request, 'Throw me — topic two');

    await page.goto('/');
    await expect(page.getByTestId('deck-queue')).toBeVisible();

    // Drain the deck: throw whatever open card is on stage (well tap = a real, price-stamped pick),
    // skip anything that isn't throwable, bounded so a stuck state fails instead of hanging.
    for (let i = 0; i < 12; i += 1) {
      if (await page.getByTestId('deck-cleared').isVisible().catch(() => false)) break;
      const yesWell = page.getByTestId('pick-yes').first();
      if (await yesWell.isVisible().catch(() => false)) {
        await yesWell.click();
      } else {
        await page.getByTestId('pick-yes').first().focus().catch(() => {});
        await page.keyboard.press('ArrowUp').catch(() => {});
      }
      await page.waitForTimeout(400);
    }

    await expect(page.getByTestId('deck-cleared')).toBeVisible();
    await expect(page.getByTestId('deck-cleared')).toContainText('Stack cleared');
    const sweat = page.getByTestId('deck-sweat-link');
    await expect(sweat).toHaveAttribute('href', '/sweat');
  });
});

test.describe('WS18-T3 flag-off regression (seam 6: flag off ⇒ `/` byte-identical to today)', () => {
  test.skip(STACK_ON, 'the mixed stack is on in this environment');

  test('`/` renders the single-question path, never the mixed stack deck', async ({ page }) => {
    await page.goto('/');
    // The mixed stack deck must not exist with the flag off.
    await expect(page.getByTestId('deck-queue')).toHaveCount(0);
    await expect(page.getByTestId('deck-progress')).toHaveCount(0);
    // Today's single-question render is present instead: either a question state or the empty
    // state — exactly what shipped before this task (uncontrolled "today" daily, per golden-loop).
    const single = page
      .locator('[data-testid^="question-state-"]')
      .or(page.getByTestId('no-question-today'));
    await expect(single.first()).toBeVisible();
  });
});
