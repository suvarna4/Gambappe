/**
 * WS17-T2 (journeys plan §5) E2E: the `/rivals` hub — one Rivals room with a segmented control
 * (Nemesis · Duo). Covers the AC:
 *   - `/rivals` renders both tabs signed-in, default tab nemesis; `?tab=duo` shows duo;
 *   - a ghost / signed-out visitor sees the neutral save-gate panel, NOT a redirect to `/claim`;
 *   - tab switching (nemesis ⇆ duo) navigates via `?tab=`.
 *
 * The nemesis/duo bodies themselves (`NemesisRoom`/`DuoRoom`) are the same components the
 * standalone `/nemesis` and `/duo` routes render — those routes have their own suites
 * (`nemesis-page-states.spec.ts`, `duo.spec.ts`) proving the extraction is behavior-preserving, so
 * this suite only asserts the HUB wiring (tab presence, selection, save-gate) rather than
 * re-testing each room's internals.
 *
 * Session-seeding helpers (`seedClaimedProfileWithSession`, `addSessionCookie`,
 * `SESSION_COOKIE_NAME`) follow `nemesis-page-states.spec.ts`'s header-documented pattern verbatim
 * (a real Auth.js "database"-strategy session on an already-`claimed` profile). `playwright.config.ts`
 * sets `FLAG_DUO_QUEUE=true` for the whole run, so the Duo segment is shown.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { connect, profiles, sessions, users, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

// See `nemesis-page-states.spec.ts`'s header comment on this exact constant — `next start` always
// runs with `NODE_ENV=production`, so `useSecureCookies` (`apps/web/auth.ts`) is always true here.
const SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

async function seedClaimedProfileWithSession(handle: string): Promise<{ profileId: string; sessionToken: string }> {
  const userId = randomUUID();
  const email = `rivals-hub-${randomUUID()}@example.test`;
  await db.insert(users).values({ id: userId, email, ageAttestedAt: new Date() });

  const [profile] = await db
    .insert(profiles)
    .values(buildProfile({ kind: 'claimed', status: 'active', userId, handle }))
    .returning();

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });

  return { profileId: profile!.id as string, sessionToken };
}

async function addSessionCookie(page: Page, sessionToken: string): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('/rivals hub (journeys plan §5, real Postgres + HTTP)', () => {
  test('signed-in: renders both tabs, defaults to the nemesis tab', async ({ page }) => {
    const { sessionToken } = await seedClaimedProfileWithSession(`E2E Rivals Default ${randomUUID()}`);
    await addSessionCookie(page, sessionToken);

    await page.goto('/rivals');

    // The hub chrome and both segments (Duo shown because FLAG_DUO_QUEUE=true for this run).
    await expect(page.getByTestId('rivals-tabs')).toBeVisible();
    await expect(page.getByTestId('rivals-tab-nemesis')).toBeVisible();
    await expect(page.getByTestId('rivals-tab-duo')).toBeVisible();

    // Default tab is nemesis: the nemesis panel renders (this freshly-seeded profile has no
    // pairing, so it's the nemesis empty state), and the duo panel does not.
    await expect(page.getByTestId('rivals-nemesis-panel')).toBeVisible();
    await expect(page.getByTestId('nemesis-empty-state')).toBeVisible();
    await expect(page.getByTestId('rivals-duo-panel')).toHaveCount(0);
    // The nemesis tab is the selected one.
    await expect(page.getByTestId('rivals-tab-nemesis')).toHaveAttribute('aria-current', 'page');
  });

  test('signed-in: ?tab=duo shows the duo room', async ({ page }) => {
    const { sessionToken } = await seedClaimedProfileWithSession(`E2E Rivals Duo ${randomUUID()}`);
    await addSessionCookie(page, sessionToken);

    await page.goto('/rivals?tab=duo');

    await expect(page.getByTestId('rivals-duo-panel')).toBeVisible();
    // `DuoRoom` server-renders the hub heading regardless of the client island's fetch state.
    await expect(page.getByRole('heading', { name: 'Your duo' })).toBeVisible();
    await expect(page.getByTestId('rivals-nemesis-panel')).toHaveCount(0);
    await expect(page.getByTestId('rivals-tab-duo')).toHaveAttribute('aria-current', 'page');
  });

  test('signed-in: switching tabs navigates via ?tab=', async ({ page }) => {
    const { sessionToken } = await seedClaimedProfileWithSession(`E2E Rivals Switch ${randomUUID()}`);
    await addSessionCookie(page, sessionToken);

    await page.goto('/rivals');
    await expect(page.getByTestId('rivals-nemesis-panel')).toBeVisible();

    await page.getByTestId('rivals-tab-duo').click();
    await expect(page).toHaveURL(/\/rivals\?tab=duo$/);
    await expect(page.getByTestId('rivals-duo-panel')).toBeVisible();

    await page.getByTestId('rivals-tab-nemesis').click();
    await expect(page).toHaveURL(/\/rivals\?tab=nemesis$/);
    await expect(page.getByTestId('rivals-nemesis-panel')).toBeVisible();
  });

  test('ghost / signed-out: sees the save-gate panel, not a redirect to /claim', async ({ page }) => {
    // No session cookie — a fully anonymous visitor.
    await page.goto('/rivals');

    await expect(page.getByTestId('rivals-save-gate')).toBeVisible();
    // The whole point of the hub over the old `/nemesis` redirect: the URL stays on `/rivals`.
    await expect(page).toHaveURL(/\/rivals$/);
    // The inline claim entry is the neutral gate (same one `/duo` shows an unclaimed visitor).
    await expect(page.getByTestId('claim-entry')).toBeVisible();
  });
});
