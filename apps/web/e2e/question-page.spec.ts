/**
 * WS7-T2 E2E: the question page's 5 states + the pick-as-ghost/undo flow (design doc §19.3 AC
 * "E2E pick-as-ghost", §10.3).
 *
 * Seeds real questions directly into Postgres (`DATABASE_URL`, migrated by the `e2e` CI job —
 * see `.github/workflows/ci.yml`) since `lib/question-view.ts` reads the DB directly for SSR
 * (see that file's header for why). `GET /me`, `POST .../picks`, and `DELETE /picks/:id` are
 * intercepted via Playwright route mocking: none of the three are merged yet
 * (`lib/pick-client.ts`'s header comment has the full breakdown) — this test exercises the
 * real client-side pick/undo behavior (button taps, the age-gate two-tap flow, optimistic
 * receipt/undo rendering) against contract-shaped mocked responses, which is what "mock-start"
 * (§0.2/§19.2) buys this task ahead of WS3-T2 landing.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import type pg from 'pg';

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

/**
 * `playwright.config.ts` runs `fullyParallel: true` across multiple worker PROCESSES against
 * one shared Postgres — `@receipts/db/testing`'s factories key their defaults (venue_market_id,
 * question slug/date) off an in-memory counter that resets per process, so two workers can both
 * produce e.g. `KX-TEST-1` and collide on the real unique constraints. Force every unique-ish
 * default to a fresh UUID/random suffix per call instead of relying on the shared counter.
 */
async function seedQuestion(
  marketOverrides: Parameters<typeof buildMarket>[0] = {},
  questionOverrides: Parameters<typeof buildQuestion>[1] = {},
) {
  const unique = randomUUID();
  const market = buildMarket({ venueMarketId: `KX-E2E-${unique}`, ...marketOverrides });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    slug: `e2e-${unique}`,
    questionDate: null,
    ...questionOverrides,
  });
  await db.insert(questions).values(question);
  return { market, question };
}

const FRESH_ME_BODY = {
  data: {
    profile: {
      profile_id: '018f1e2b-0000-7000-8000-0000000000e1',
      handle: 'Otter #4821',
      slug: 'otter-4821',
      kind: 'ghost',
      status: 'active',
      handle_is_generated: true,
      created_at: '2026-07-01T00:00:00Z',
      claimed_at: null,
      age_attested: false,
      timezone: null,
      streak: { current: 0, best: 0, freeze_bank: 0, last_counted_date: null },
      win_streak: { current: 0, best: 0 },
    },
    settings: {
      nemesis_paused: false,
      show_wallet_address: false,
      notifications: {
        email_reveal: true,
        email_nemesis: true,
        email_duo: true,
        email_product: false,
        push_reveal: true,
        push_nemesis: true,
        push_duo: true,
      },
    },
    eligibility: {
      graded_picks: 0,
      nemesis_required: 5,
      duo_required: 10,
      nemesis_eligible: false,
      duo_eligible: false,
    },
    claim: { claimed: false },
  },
};

test.describe('question page states (§10.3)', () => {
  test('scheduled: shows the opens countdown, no pick buttons', async ({ page }) => {
    const now = Date.now();
    const { question } = await seedQuestion(
      {},
      { status: 'scheduled', openAt: new Date(now + 3_600_000), lockAt: new Date(now + 7_200_000) },
    );
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-scheduled')).toBeVisible();
    await expect(page.getByTestId('pick-yes')).not.toBeVisible();
  });

  test('locked: shows the crowd split from the lock snapshot', async ({ page }) => {
    // §5.7 effective-state rule: the page derives status from timestamps, not the raw column
    // (see lib/question-view.ts) — open_at/lock_at must actually be in the past for this to
    // render as locked regardless of what raw `status` says, so they're set explicitly here
    // rather than relying on the test-factory's fixed 2026-07-19 anchor date.
    const now = Date.now();
    const { question } = await seedQuestion(
      {},
      {
        status: 'locked',
        openAt: new Date(now - 7_200_000),
        lockAt: new Date(now - 3_600_000),
        crowdYesAtLock: 7,
        crowdNoAtLock: 3,
        yesLabel: 'France',
        noLabel: 'Brazil',
      },
    );
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-locked')).toBeVisible();
    await expect(page.getByTestId('question-locked')).toContainText('France 70%');
  });

  test('revealed: shows the outcome', async ({ page }) => {
    const { question } = await seedQuestion(
      {},
      {
        status: 'revealed',
        outcome: 'yes',
        crowdYesAtLock: 6,
        crowdNoAtLock: 4,
        yesLabel: 'Yes it will',
        revealedAt: new Date(),
      },
    );
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-revealed')).toBeVisible();
    await expect(page.getByTestId('question-revealed')).toContainText('Yes it will');
  });

  test('voided: shows the VOID stamp and explainer', async ({ page }) => {
    const { question } = await seedQuestion(
      {},
      { status: 'voided', voidReason: 'venue cancelled the event' },
    );
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-voided')).toBeVisible();
    await expect(page.getByTestId('question-voided')).toContainText('venue cancelled the event');
  });

  test('unknown slug 404s', async ({ page }) => {
    const res = await page.goto('/q/does-not-exist');
    expect(res?.status()).toBe(404);
  });
});

test.describe('pick-as-ghost + undo (§6.2, AC: "E2E pick-as-ghost")', () => {
  test('tap a side → age-gate confirm → receipt + undo → undo → back to pick buttons', async ({
    page,
  }) => {
    const now = Date.now();
    const { question } = await seedQuestion(
      { yesPrice: 0.63 },
      {
        status: 'open',
        openAt: new Date(now - 3_600_000),
        lockAt: new Date(now + 3_600_000),
        yesLabel: 'Yes',
        noLabel: 'No',
      },
    );

    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ status: 200, json: FRESH_ME_BODY }),
    );

    let pickPosted = false;
    await page.route(`**/api/v1/questions/${question.id}/picks`, async (route) => {
      const body = route.request().postDataJSON() as { side: string; age_attested?: boolean };
      expect(body.side).toBe('yes');
      expect(body.age_attested).toBe(true); // fresh ghost, age_attested:false → two-tap flow required
      pickPosted = true;
      await route.fulfill({
        status: 201,
        json: {
          data: {
            pick: {
              id: '018f1e2b-0000-7000-8000-0000000000f1',
              question_id: question.id,
              profile_id: FRESH_ME_BODY.data.profile.profile_id,
              side: 'yes',
              yes_price_at_entry: 0.63,
              price_stamped_at: new Date().toISOString(),
              picked_at: new Date().toISOString(),
              source: 'spectator_page',
              confidence: null,
              result: 'pending',
              edge: null,
            },
            undo_until: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
    });

    let undoCalled = false;
    await page.route('**/api/v1/picks/018f1e2b-0000-7000-8000-0000000000f1', async (route) => {
      undoCalled = true;
      await route.fulfill({ status: 200, json: { data: { deleted: true } } });
    });

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-open')).toBeVisible();

    await expect(page.getByTestId('viewer-strip-pick-buttons')).toBeVisible();
    await page.getByTestId('pick-yes').click();

    // Fresh ghost (age_attested:false) → the two-tap age-gate confirm shows first (DD-11/INV-9).
    await expect(page.getByTestId('age-gate')).toBeVisible();
    await page.getByTestId('age-gate-confirm').click();

    await expect(page.getByTestId('viewer-strip-pick')).toBeVisible();
    await expect(page.getByTestId('viewer-strip-pick')).toContainText('Yes');
    expect(pickPosted).toBe(true);

    await expect(page.getByTestId('undo-pick')).toBeVisible();
    await page.getByTestId('undo-pick').click();

    await expect(page.getByTestId('viewer-strip-pick-buttons')).toBeVisible();
    expect(undoCalled).toBe(true);
  });

  test('an already-attested ghost skips the age gate entirely', async ({ page }) => {
    const now = Date.now();
    const { question } = await seedQuestion(
      {},
      { status: 'open', openAt: new Date(now - 3_600_000), lockAt: new Date(now + 3_600_000) },
    );

    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        status: 200,
        json: {
          data: {
            ...FRESH_ME_BODY.data,
            profile: { ...FRESH_ME_BODY.data.profile, age_attested: true },
          },
        },
      }),
    );
    await page.route(`**/api/v1/questions/${question.id}/picks`, async (route) => {
      const body = route.request().postDataJSON() as { side: string; age_attested?: boolean };
      expect(body.age_attested).toBeUndefined(); // already attested — never re-sent
      await route.fulfill({
        status: 201,
        json: {
          data: {
            pick: {
              id: '018f1e2b-0000-7000-8000-0000000000f2',
              question_id: question.id,
              profile_id: FRESH_ME_BODY.data.profile.profile_id,
              side: 'no',
              yes_price_at_entry: 0.5,
              price_stamped_at: new Date().toISOString(),
              picked_at: new Date().toISOString(),
              source: 'spectator_page',
              confidence: null,
              result: 'pending',
              edge: null,
            },
            undo_until: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
    });

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('viewer-strip-pick-buttons')).toBeVisible();
    await page.getByTestId('pick-no').click();
    await expect(page.getByTestId('age-gate')).not.toBeVisible();
    await expect(page.getByTestId('viewer-strip-pick')).toBeVisible();
  });
});

test.describe('reveal sequence (§10.3, WS7-T3)', () => {
  function revealMockBody(question: { id: string; slug?: string | null }, viewer?: unknown) {
    return {
      data: {
        question: {
          id: question.id,
          slug: question.slug,
          kind: 'daily',
          status: 'revealed',
          question_date: '2026-07-19',
          headline: 'Will it happen?',
          blurb: null,
          yes_label: 'Yes it will',
          no_label: 'No it will not',
          open_at: '2026-07-19T13:00:00Z',
          lock_at: '2026-07-19T16:00:00Z',
          reveal_at: '2026-07-20T00:00:00Z',
          yes_price: 0.63,
          yes_price_updated_at: '2026-07-19T13:00:00Z',
          crowd: { yes: 6, no: 4, pct_yes: 60 },
          outcome: 'yes',
          revealed_at: new Date().toISOString(),
          void_reason: null,
          is_volatile: false,
          venue: 'kalshi',
          venue_url: 'https://kalshi.example/markets/test',
        },
        outcome: 'yes',
        crowd: { yes: 6, no: 4, pct_yes: 60 },
        narrative_line: '60% called it. Yes it will it is.',
        share: {
          page_url: `https://receipts.example/q/${question.slug}`,
          og_url: `https://receipts.example/api/og/q/${question.slug}`,
          card_urls: [],
        },
        ...(viewer ? { viewer } : {}),
      },
    };
  }

  test('a winning pick plays the client reveal sequence: result stamp, percentile, streak', async ({
    page,
  }) => {
    const { question } = await seedQuestion(
      {},
      {
        status: 'revealed',
        outcome: 'yes',
        crowdYesAtLock: 6,
        crowdNoAtLock: 4,
        yesLabel: 'Yes it will',
        revealedAt: new Date(),
      },
    );

    await page.route(`**/api/v1/questions/${question.slug}/reveal`, (route) =>
      route.fulfill({
        status: 200,
        json: revealMockBody(question, {
          pick: {
            id: '018f1e2b-0000-7000-8000-0000000000f9',
            question_id: question.id,
            profile_id: '018f1e2b-0000-7000-8000-0000000000e1',
            side: 'yes',
            yes_price_at_entry: 0.63,
            price_stamped_at: '2026-07-19T13:00:00Z',
            picked_at: '2026-07-19T13:00:00Z',
            source: 'spectator_page',
            confidence: null,
            result: 'win',
            edge: 0.37,
          },
          result: 'win',
          edge: 0.37,
          percentile: 82,
          streak: { current: 4, best: 4, delta: 1, freeze_used: false },
          badges: [],
        }),
      }),
    );

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-result')).toContainText('WIN');
    // §8.6 "Top X%" display convention: X = 100 − percentile, so raw 82 → "Top 18%".
    await expect(page.getByTestId('reveal-sequence-percentile')).toContainText('Top 18%');
    await expect(page.getByTestId('reveal-sequence-streak')).toContainText('4');

    // §10.5 WS8-T2: a graded win offers the share sheet right here — `RevealSequence` (WS7-T3)
    // owns the whole `revealed` state, so this is the only place a revealed question's share
    // button can live; wired against the mocked reveal's `pick.id` as the receipt card target.
    await page.getByTestId('share-receipt-button').click();
    const sheet = page.getByTestId('share-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('share-preview-image')).toHaveAttribute(
      'src',
      /\/api\/cards\/receipt\/018f1e2b-0000-7000-8000-0000000000f9\?format=square/,
    );
  });

  test("no viewer pick: shows the \"didn't pick this one\" copy, no result stamp", async ({
    page,
  }) => {
    const { question } = await seedQuestion(
      {},
      {
        status: 'revealed',
        outcome: 'yes',
        crowdYesAtLock: 6,
        crowdNoAtLock: 4,
        revealedAt: new Date(),
      },
    );

    await page.route(`**/api/v1/questions/${question.slug}/reveal`, (route) =>
      route.fulfill({ status: 200, json: revealMockBody(question) }),
    );

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('reveal-sequence-no-pick')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-no-pick')).toContainText(
      "You didn't pick this one.",
    );
    await expect(page.getByTestId('reveal-sequence-result')).not.toBeVisible();
  });

  test('prefers-reduced-motion: the result still renders (no animation wait blocks it)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { question } = await seedQuestion(
      {},
      {
        status: 'revealed',
        outcome: 'yes',
        crowdYesAtLock: 6,
        crowdNoAtLock: 4,
        revealedAt: new Date(),
      },
    );

    await page.route(`**/api/v1/questions/${question.slug}/reveal`, (route) =>
      route.fulfill({
        status: 200,
        json: revealMockBody(question, {
          pick: {
            id: '018f1e2b-0000-7000-8000-0000000000fa',
            question_id: question.id,
            profile_id: '018f1e2b-0000-7000-8000-0000000000e2',
            side: 'yes',
            yes_price_at_entry: 0.63,
            price_stamped_at: '2026-07-19T13:00:00Z',
            picked_at: '2026-07-19T13:00:00Z',
            source: 'spectator_page',
            confidence: null,
            result: 'loss',
            edge: -0.63,
          },
          result: 'loss',
          edge: -0.63,
          percentile: 20,
          streak: { current: 0, best: 4, delta: -4, freeze_used: false },
          badges: [],
        }),
      }),
    );

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-result')).toContainText('LOSS');
  });
});

test.describe('INV-10 — spectator page is viewer-free at the HTTP layer', () => {
  test('identical HTML with and without an identity-shaped cookie', async ({ request }) => {
    const { question } = await seedQuestion(
      {},
      // revealed: no live countdown text, so the two responses can't differ on wall-clock jitter.
      {
        status: 'revealed',
        outcome: 'yes',
        crowdYesAtLock: 5,
        crowdNoAtLock: 5,
        revealedAt: new Date(),
      },
    );
    const anonymous = await request.get(`/q/${question.slug}`);
    const withCookie = await request.get(`/q/${question.slug}`, {
      headers: { cookie: 'rcpt_gid=00000000-0000-7000-8000-000000000000.not-a-real-secret' },
    });
    expect(anonymous.status()).toBe(200);
    expect(withCookie.status()).toBe(200);
    expect(await anonymous.text()).toBe(await withCookie.text());
  });
});
