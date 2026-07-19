/**
 * WS7-T7 (duo UI) E2E: the private `/duo` hub (claim-gated, queue join/leave, active-duo +
 * disband) and the public `/duos/[id]` + `/ladder` pages (design doc §8.5/§8.9/§8.10, §9.2,
 * §19.3 WS7-T7 AC).
 *
 * `/duos/[id]` and `/ladder` read Postgres directly for SSR (`serialize-duo.ts`/`duo-ladder.ts`)
 * — mirrors `question-page.spec.ts`'s header: seeds real rows via `@receipts/db/testing`
 * factories rather than mocking, since there's no client-side fetch to intercept for a
 * server-rendered page. `GET /me`, `GET /duo/current`, `POST`/`DELETE /duo/queue`, and
 * `POST /duos/:id/disband` ARE real client-side fetches from `/duo` (WS6-T1/WS6-T4, merged) —
 * intercepted via Playwright route mocking for determinism, same rationale
 * `settings.spec.ts` uses for its own real-but-mocked routes.
 *
 * `playwright.config.ts` sets `FLAG_DUO_QUEUE=true` for this whole e2e run (mirrors that file's
 * `ADMIN_STOPGAP_TOKEN` precedent) — every duo route 404s otherwise (§4.6).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, duos, profiles, type Db } from '@receipts/db';
import { buildDuo, buildProfile } from '@receipts/db/testing';
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

async function seedDuo() {
  const unique = randomUUID();
  const a = buildProfile({ kind: 'claimed', status: 'active', handle: `E2E-A-${unique}` });
  const b = buildProfile({ kind: 'claimed', status: 'active', handle: `E2E-B-${unique}` });
  await db.insert(profiles).values([a, b]);
  const [aId, bId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const duo = buildDuo(aId, bId, { matchesPlayed: 3, glickoRating: 1580 });
  await db.insert(duos).values(duo);
  return { a, b, duo };
}

// --- Public pages (real Postgres, no mocking) --------------------------------------------------

test.describe('public duo pages (§9.2, real Postgres)', () => {
  test('/duos/[id] renders both partner handles, tier, rating, and an empty match history', async ({
    page,
  }) => {
    const { a, b, duo } = await seedDuo();

    await page.goto(`/duos/${duo.id}`);
    // Scoped to <main> — the page's own <title> is `${a.handle} & ${b.handle} — Receipts`
    // (generateMetadata), so an unscoped page.getByText(a.handle)/getByText(b.handle) is a
    // strict-mode violation: it matches both the visible partner text and the <title> element.
    const main = page.locator('main');
    await expect(main.getByText(a.handle)).toBeVisible();
    await expect(main.getByText(b.handle)).toBeVisible();
    await expect(main.getByText('Tier 1 · Paper')).toBeVisible();
    await expect(main.getByText('1580')).toBeVisible();
    await expect(main.getByText('No matches yet.')).toBeVisible();
  });

  test('/duos/[id] 404s for an unknown id', async ({ page }) => {
    const response = await page.goto(`/duos/${randomUUID()}`);
    expect(response?.status()).toBe(404);
  });

  test('/ladder lists a seeded active duo', async ({ page }) => {
    const { a, b } = await seedDuo();

    await page.goto('/ladder');
    await expect(page.getByRole('heading', { name: 'Duo ladder' })).toBeVisible();
    await expect(page.getByText(`${a.handle} & ${b.handle}`)).toBeVisible();
  });
});

// --- Private hub (mocked client-side fetches) ---------------------------------------------------

const GHOST_ME_BODY = {
  data: {
    profile: {
      profile_id: '018f1e2b-0000-7000-8000-0000000000f1',
      handle: 'Otter #9001',
      slug: 'otter-9001',
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
      graded_picks: 2,
      nemesis_required: 5,
      duo_required: 10,
      nemesis_eligible: false,
      duo_eligible: false,
    },
    claim: { claimed: false },
  },
};

function claimedMeBody(overrides: { graded_picks?: number; duo_eligible?: boolean } = {}) {
  return {
    data: {
      ...GHOST_ME_BODY.data,
      profile: { ...GHOST_ME_BODY.data.profile, kind: 'claimed', claimed_at: '2026-07-02T00:00:00Z' },
      eligibility: {
        ...GHOST_ME_BODY.data.eligibility,
        graded_picks: overrides.graded_picks ?? 12,
        duo_eligible: overrides.duo_eligible ?? true,
      },
      claim: { claimed: true },
    },
  };
}

const EMPTY_CURRENT_DUO = { data: { duo: null, match: null } };

test.describe('/duo hub (§8.5, §9.2, mocked client fetches)', () => {
  test('not claimed (ghost): shows the claim-required notice + inline claim entry', async ({
    page,
  }) => {
    await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: GHOST_ME_BODY }));

    await page.goto('/duo');
    await expect(page.getByTestId('duo-hub-not-claimed')).toBeVisible();
    await expect(page.getByTestId('claim-entry')).toBeVisible();
  });

  test('claimed but below DUO_MIN_PICKS: shows eligibility progress, no queue button', async ({
    page,
  }) => {
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ status: 200, json: claimedMeBody({ graded_picks: 3, duo_eligible: false }) }),
    );
    await page.route('**/api/v1/duo/current', (route) =>
      route.fulfill({ status: 200, json: EMPTY_CURRENT_DUO }),
    );

    await page.goto('/duo');
    await expect(page.getByTestId('duo-not-eligible')).toBeVisible();
    await expect(page.getByTestId('duo-not-eligible')).toContainText('3/10');
    await expect(page.getByTestId('duo-join-queue-button')).toHaveCount(0);
  });

  test('claimed + eligible + no duo: join queue button POSTs, then shows queued state', async ({
    page,
  }) => {
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ status: 200, json: claimedMeBody() }),
    );
    await page.route('**/api/v1/duo/current', (route) =>
      route.fulfill({ status: 200, json: EMPTY_CURRENT_DUO }),
    );
    let joinCalled = false;
    await page.route('**/api/v1/duo/queue', async (route) => {
      if (route.request().method() === 'POST') {
        joinCalled = true;
        await route.fulfill({
          status: 201,
          json: { data: { entry: { id: randomUUID(), status: 'waiting', enqueued_at: '2026-07-18T12:00:00Z' } } },
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/duo');
    await expect(page.getByTestId('duo-not-queued')).toBeVisible();
    await page.getByTestId('duo-join-queue-button').click();

    await expect(page.getByTestId('duo-queued')).toBeVisible();
    expect(joinCalled).toBe(true);
  });

  test('active duo: renders the duo card, match strip, and a working disband confirm flow', async ({
    page,
  }) => {
    const duoId = randomUUID();
    const currentDuoBody = {
      data: {
        duo: {
          id: duoId,
          status: 'active',
          tier: 3,
          partners: [
            { profile_id: '018f1e2b-0000-7000-8000-0000000000f1', handle: 'Otter #9001', slug: 'otter-9001' },
            { profile_id: '018f1e2b-0000-7000-8000-0000000000f2', handle: 'Heron #42', slug: 'heron-42' },
          ],
          rating: { glicko_rating: 1610, glicko_rd: 90 },
          matches_played: 6,
          joint_hit_rate: 0.58,
          synergy: 0.03,
        },
        match: {
          id: randomUUID(),
          duo_a_id: duoId,
          duo_b_id: randomUUID(),
          window_start: '2026-07-14',
          window_end: '2026-07-16',
          status: 'active',
          score: { a: 2, b: 1 },
          winner_duo_id: null,
        },
      },
    };

    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ status: 200, json: claimedMeBody() }),
    );
    await page.route('**/api/v1/duo/current', (route) =>
      route.fulfill({ status: 200, json: currentDuoBody }),
    );
    let disbandCalled = false;
    await page.route(`**/api/v1/duos/${duoId}/disband`, async (route) => {
      disbandCalled = true;
      await route.fulfill({ status: 200, json: { data: { disbanded: true } } });
    });

    await page.goto('/duo');
    await expect(page.getByTestId('duo-active')).toBeVisible();
    await expect(page.getByText('Heron #42')).toBeVisible();
    await expect(page.getByText('2–1')).toBeVisible();

    await page.getByTestId('duo-disband-open').click();
    await expect(page.getByTestId('duo-disband-confirm')).toBeVisible();
    await expect(page.getByTestId('duo-disband-confirm')).toContainText('Heron #42');

    await page.getByTestId('duo-disband-confirm-button').click();
    await expect(page.getByTestId('duo-disband-done')).toBeVisible();
    expect(disbandCalled).toBe(true);
  });
});
