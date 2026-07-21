/**
 * WS23-T1 · Journey 5 (docs/journeys-plan.md §5): the call-out loop — WS20-T4's AC promoted into
 * the journey gate. A (claimed) mints a challenge link; B (a fresh ghost) previews it and sees
 * "YOU'VE BEEN CALLED OUT" with Accept routed through the Save flow (not a live POST); after saving
 * (a claimed session), B accepts → the pairing exists and BOTH `/rivals` hubs show the accepted
 * "locked in" card. No free-text input anywhere — every action is a button/stamp (§5 AC).
 *
 * Mirrors `callouts-loop.spec.ts` verbatim in shape (real Auth.js sessions on claimed profiles, the
 * raw token minted by an in-page authenticated POST — same-origin, so `assertSameOrigin` passes via
 * `Sec-Fetch-Site: same-origin` even on this project's alternate port). `callouts` is ON in the
 * journeys webServer flag set.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  addSessionCookie,
  connectDb,
  seedClaimedProfileWithSession,
  type DbHandle,
} from './_journey-helpers';

let handle: DbHandle;

test.beforeAll(() => {
  handle = connectDb();
});

test.afterAll(async () => {
  await handle.pool.end();
});

/** Mint a call-out link as the signed-in page, returning the raw token from `share_url`. */
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
  const token = new URL(shareUrl, 'http://localhost:3001').searchParams.get('callout');
  expect(token, 'share_url must carry a raw callout token').toBeTruthy();
  return token!;
}

test.describe('Journey 5 · call-out loop (D-J5)', () => {
  test('A creates a link → B (ghost) previews → saves → accepts → both hubs show the pairing', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const challengerHandle = `Journey Challenger ${randomUUID()}`;
    const opponentHandle = `Journey Opponent ${randomUUID()}`;
    const a = await seedClaimedProfileWithSession(handle.db, { handle: challengerHandle });
    const b = await seedClaimedProfileWithSession(handle.db, { handle: opponentHandle });

    // --- A mints a call-out link ---------------------------------------------------------------
    await addSessionCookie(context, a.sessionToken);
    await page.goto('/rivals');
    const token = await mintCalloutToken(page);

    // --- B, a fresh ghost, opens the preview ---------------------------------------------------
    await context.clearCookies();
    await page.goto(`/rivals?callout=${token}`);
    await expect(page.getByTestId('incoming-callout-card')).toBeVisible();
    await expect(page.getByText("YOU'VE BEEN CALLED OUT")).toBeVisible();
    await expect(page.getByText(challengerHandle)).toBeVisible();
    // Accept-while-ghost is a Save-flow link with a ?next= return (D-J8), not a live accept.
    await expect(page.getByTestId('incoming-callout-accept')).toHaveAttribute(
      'href',
      new RegExp(`/claim\\?next=.*callout%3D${token}`),
    );

    // --- B saves (claimed session) and accepts -------------------------------------------------
    await addSessionCookie(context, b.sessionToken);
    await page.goto(`/rivals?callout=${token}`);
    await page.getByTestId('incoming-callout-accept').click();
    const bAcceptedCard = page.getByTestId('accepted-callout-card').first();
    await expect(bAcceptedCard).toBeVisible();
    await expect(bAcceptedCard).toContainText(challengerHandle);

    // --- A's screen also shows the accepted pairing (§5 AC — both screens) ---------------------
    await context.clearCookies();
    await addSessionCookie(context, a.sessionToken);
    await page.goto('/rivals');
    const aAcceptedCard = page.getByTestId('accepted-callout-card').first();
    await expect(aAcceptedCard).toBeVisible();
    await expect(aAcceptedCard).toContainText(opponentHandle);
  });
});
