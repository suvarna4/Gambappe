/**
 * WS7-T8 E2E: the §10.3 `revealed`-state thread (§9.2 AC: "ghost sees read + reactions, post box
 * gated with claim prompt"). Follows `question-page.spec.ts`'s pattern: seeds a real revealed
 * question directly into Postgres, then mocks `GET /me`, `GET .../reveal`, `GET .../thread`,
 * `POST .../posts`, and `POST /reactions` via Playwright route interception for deterministic
 * identity/content — same posture that file's own "revealed" describe block already uses even
 * for merged routes, so UI/interaction correctness stays independent of live network timing. The
 * routes themselves (real, merged in this same PR) get their own coverage in
 * `test/integration/threads.test.ts`.
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

async function seedRevealedQuestion() {
  const unique = randomUUID();
  const market = buildMarket({ venueMarketId: `KX-THREAD-${unique}` });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    slug: `thread-e2e-${unique}`,
    questionDate: null,
    status: 'revealed',
    outcome: 'yes',
    crowdYesAtLock: 6,
    crowdNoAtLock: 4,
    yesLabel: 'Yes it will',
    revealedAt: new Date(),
  });
  await db.insert(questions).values(question);
  return question;
}

function meBody(kind: 'ghost' | 'claimed') {
  return {
    data: {
      profile: {
        profile_id: '018f1e2b-0000-7000-8000-0000000000e1',
        handle: 'Otter #4821',
        slug: 'otter-4821',
        kind,
        status: 'active',
        handle_is_generated: true,
        created_at: '2026-07-01T00:00:00Z',
        claimed_at: kind === 'claimed' ? '2026-07-02T00:00:00Z' : null,
        age_attested: true,
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
        graded_picks: 5,
        nemesis_required: 5,
        duo_required: 10,
        nemesis_eligible: true,
        duo_eligible: false,
      },
      claim: { claimed: kind === 'claimed' },
    },
  };
}

function revealBody(question: { id: string; slug?: string | null }) {
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
    },
  };
}

function threadBody(posts: Array<{ id: string; handle: string; body: string }> = []) {
  return {
    data: {
      data: {
        posts: posts.map((p) => ({
          id: p.id,
          context_kind: 'question',
          context_id: '018f1e2b-0000-7000-8000-000000000abc',
          author: { profile_id: '018f1e2b-0000-7000-8000-0000000000e1', handle: p.handle, slug: 'otter-4821' },
          body: p.body,
          status: 'visible',
          created_at: new Date().toISOString(),
        })),
        reaction_counts: [{ emoji: '🔥', count: 2 }],
      },
      meta: { next_cursor: null },
    },
  };
}

test.describe('question thread (§9.2, §10.3 revealed state, WS7-T8)', () => {
  test('ghost sees the read (posts) + reactions; the post box is gated with a claim prompt', async ({ page }) => {
    const question = await seedRevealedQuestion();

    await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: meBody('ghost') }));
    await page.route(`**/api/v1/questions/${question.slug}/reveal`, (route) =>
      route.fulfill({ status: 200, json: revealBody(question) }),
    );
    await page.route(`**/api/v1/questions/${question.slug}/thread`, (route) =>
      route.fulfill({ status: 200, json: threadBody([{ id: randomUUID(), handle: 'Fox #1', body: 'called it' }]) }),
    );

    let reactionPosted = false;
    await page.route('**/api/v1/reactions', async (route) => {
      const body = route.request().postDataJSON() as { context_kind: string; context_id: string; emoji: string };
      expect(body.context_kind).toBe('question');
      expect(body.context_id).toBe(question.id);
      reactionPosted = true;
      await route.fulfill({ status: 200, json: { data: { state: 'added' } } });
    });

    let postsCalled = false;
    await page.route(`**/api/v1/questions/${question.id}/posts`, async (route) => {
      postsCalled = true;
      await route.fulfill({ status: 201, json: { data: { post: {} } } });
    });

    await page.goto(`/q/${question.slug}`);

    await expect(page.getByTestId('question-thread')).toBeVisible();
    await expect(page.getByTestId('thread-post')).toContainText('called it');
    await expect(page.getByTestId('reaction-bar')).toBeVisible();

    // Ghost reacts — real ghost-tier capability (§9.2 `POST /reactions` is `ghost+`).
    await page.getByTestId('reaction-🔥').click();
    await expect(page.getByTestId('reaction-🔥')).toContainText('3'); // optimistic 2 -> 3
    expect(reactionPosted).toBe(true);

    // Post box: visible, but focusing it as a ghost opens the claim prompt instead of letting
    // them type/submit (AC: "post box gated with claim prompt").
    await expect(page.getByTestId('post-composer')).toBeVisible();
    await page.getByTestId('post-composer-input').click();
    await expect(page.getByTestId('claim-sheet')).toBeVisible();
    expect(postsCalled).toBe(false);
  });

  test('a claimed profile can post to the thread', async ({ page }) => {
    const question = await seedRevealedQuestion();

    await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: meBody('claimed') }));
    await page.route(`**/api/v1/questions/${question.slug}/reveal`, (route) =>
      route.fulfill({ status: 200, json: revealBody(question) }),
    );
    await page.route(`**/api/v1/questions/${question.slug}/thread`, (route) =>
      route.fulfill({ status: 200, json: threadBody([]) }),
    );

    let postedBody: string | undefined;
    await page.route(`**/api/v1/questions/${question.id}/posts`, async (route) => {
      const body = route.request().postDataJSON() as { body: string };
      postedBody = body.body;
      await route.fulfill({
        status: 201,
        json: {
          data: {
            post: {
              id: randomUUID(),
              context_kind: 'question',
              context_id: question.id,
              author: { profile_id: '018f1e2b-0000-7000-8000-0000000000e1', handle: 'Otter #4821', slug: 'otter-4821' },
              body: 'nice call',
              status: 'visible',
              created_at: new Date().toISOString(),
            },
          },
        },
      });
    });

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-thread')).toBeVisible();

    await page.getByTestId('post-composer-input').fill('nice call');
    await page.getByTestId('post-composer-submit').click();

    expect(postedBody).toBe('nice call');
    await expect(page.getByTestId('thread-post')).toContainText('nice call');
    await expect(page.getByTestId('post-composer-input')).toHaveValue('');
  });
});
