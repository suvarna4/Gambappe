/**
 * WS20-T4 (journeys plan §5, D-J5) E2E: the full call-out loop, promoted into the WS23-T1 journey
 * gate. Covers the AC:
 *   - A (claimed) creates a challenge link;
 *   - B (a fresh ghost) opens `/rivals?callout={token}` and sees the "YOU'VE BEEN CALLED OUT" card,
 *     with Accept routed through the Save flow (`/claim?next=…`, D-J8) rather than a live POST;
 *   - after saving (a claimed session), B accepts → the pairing exists for next week and BOTH
 *     `/rivals` screens (A's and B's) show the "locked in" accepted-call-out card;
 *   - a declined call-out and an expired link render their terminal states.
 *
 * No free-text input anywhere (§5 AC): every action is a button/stamp.
 *
 * Session-seeding (`seedClaimedProfileWithSession`, `addSessionCookie`, `SESSION_COOKIE_NAME`)
 * follows `rivals-hub.spec.ts` / `nemesis-page-states.spec.ts` verbatim (a real Auth.js
 * database-strategy session on a `claimed` profile). `playwright.config.ts` sets
 * `FLAG_CALLOUTS=true` for the whole run. The raw token is minted by an in-page `POST` from A's
 * authenticated session (same-origin, so it passes `assertSameOrigin` and carries A's cookie), the
 * only place the server ever emits it (WS20-T3).
 *
 * This suite is authored for CI (no browser is available in the implementing environment); it
 * mirrors the seeding + real-HTTP shape the sibling nemesis/rivals suites already run green under.
 */
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { callouts, connect, profiles, sessions, users, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { eq } from 'drizzle-orm';
import type pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

// `next start` runs with NODE_ENV=production, so `useSecureCookies` (auth.ts) is always true here.
const SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

async function seedClaimedProfileWithSession(
  handle: string,
): Promise<{ profileId: string; sessionToken: string }> {
  const userId = randomUUID();
  const email = `callouts-loop-${randomUUID()}@example.test`;
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

async function clearSessionCookie(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Mint a call-out link as the currently-signed-in page, returning the raw token from `share_url`. */
async function mintCalloutToken(page: Page): Promise<string> {
  const shareUrl = await page.evaluate(async () => {
    const res = await fetch('/api/v1/callouts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { data?: { share_url?: string } };
    return body.data?.share_url ?? '';
  });
  const token = new URL(shareUrl, 'http://localhost:3000').searchParams.get('callout');
  expect(token, 'share_url must carry a raw callout token').toBeTruthy();
  return token!;
}

test.describe('call-out loop (journeys plan §5 WS20-T4, real Postgres + HTTP)', () => {
  test('A creates a link → B (ghost) previews → saves → accepts → both hubs show the pairing', async ({ page }) => {
    const challengerHandle = `E2E Challenger ${randomUUID()}`;
    const opponentHandle = `E2E Opponent ${randomUUID()}`;
    const { sessionToken: aSession } = await seedClaimedProfileWithSession(challengerHandle);
    const { sessionToken: bSession } = await seedClaimedProfileWithSession(opponentHandle);

    // --- A mints a call-out link -----------------------------------------------------------
    await addSessionCookie(page, aSession);
    await page.goto('/rivals');
    const token = await mintCalloutToken(page);

    // --- B, a fresh ghost, opens the preview ------------------------------------------------
    await clearSessionCookie(page);
    await page.goto(`/rivals?callout=${token}`);
    await expect(page.getByTestId('incoming-callout-card')).toBeVisible();
    await expect(page.getByText("YOU'VE BEEN CALLED OUT")).toBeVisible();
    await expect(page.getByText(challengerHandle)).toBeVisible();
    // Accept-while-ghost is a Save-flow link with a ?next= return (D-J8), not a live accept.
    const acceptGhost = page.getByTestId('incoming-callout-accept');
    await expect(acceptGhost).toHaveAttribute('href', new RegExp(`/claim\\?next=.*callout%3D${token}`));

    // --- B saves (claimed session) and accepts ---------------------------------------------
    await addSessionCookie(page, bSession);
    await page.goto(`/rivals?callout=${token}`);
    await page.getByTestId('incoming-callout-accept').click();
    // The hub re-renders with the "locked in" card once accept resolves (§5 AC — B's screen). The
    // handle assertion is scoped to the accepted card (the incoming card also names the challenger).
    const bAcceptedCard = page.getByTestId('accepted-callout-card').first();
    await expect(bAcceptedCard).toBeVisible();
    await expect(bAcceptedCard).toContainText(challengerHandle);

    // --- A's screen also shows the accepted pairing (§5 AC — both screens) ------------------
    await clearSessionCookie(page);
    await addSessionCookie(page, aSession);
    await page.goto('/rivals');
    const aAcceptedCard = page.getByTestId('accepted-callout-card').first();
    await expect(aAcceptedCard).toBeVisible();
    await expect(aAcceptedCard).toContainText(opponentHandle);
  });

  test('a declined call-out renders the declined terminal state', async ({ page }) => {
    const { sessionToken: aSession } = await seedClaimedProfileWithSession(`E2E Decliner-A ${randomUUID()}`);
    const { sessionToken: bSession } = await seedClaimedProfileWithSession(`E2E Decliner-B ${randomUUID()}`);

    await addSessionCookie(page, aSession);
    await page.goto('/rivals');
    const token = await mintCalloutToken(page);

    await clearSessionCookie(page);
    await addSessionCookie(page, bSession);
    await page.goto(`/rivals?callout=${token}`);
    await page.getByTestId('incoming-callout-decline').click();
    await expect(page.getByTestId('incoming-callout-declined')).toBeVisible();
  });

  test('an expired link renders the expired terminal state', async ({ page }) => {
    const { sessionToken: aSession } = await seedClaimedProfileWithSession(`E2E Expiry-A ${randomUUID()}`);
    const { sessionToken: bSession } = await seedClaimedProfileWithSession(`E2E Expiry-B ${randomUUID()}`);

    await addSessionCookie(page, aSession);
    await page.goto('/rivals');
    const token = await mintCalloutToken(page);

    // Force the link past its expiry directly in the DB (the token's SHA-256 is its stored key).
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await db.update(callouts).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(callouts.tokenHash, tokenHash));

    await clearSessionCookie(page);
    await addSessionCookie(page, bSession);
    await page.goto(`/rivals?callout=${token}`);
    await expect(page.getByTestId('incoming-callout-expired')).toBeVisible();
  });
});
