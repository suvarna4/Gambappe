/**
 * WS5-T5 E2E: the rematch-request flow on `/nemesis` (design doc §8.4 step 0, §9.2
 * `POST /rematch-requests*`) through REAL HTTP routes against real Postgres — `RematchPanel`
 * (inside `NemesisHistoryList`) now calls `/api/v1/rematch-requests*` instead of the deleted
 * mock backend (`lib/nemesis/mock-api.ts`, see `/nemesis/page.tsx`'s header for the handoff).
 *
 * SW10-T2: the "ask for a rematch" affordance is now `VerdictCard`'s rematch-by-swipe close
 * (`VerdictSwipeCard`, wired in `RematchPanel`) instead of the old plain "Request rematch"
 * button + confirm dialog — a click-driven flow can't literally survive becoming a swipe. This
 * suite still verifies the exact same DB/state lifecycle it always did; only the interaction
 * step that KICKS OFF the request changed, from clicking `rematch-request-button` (then
 * confirming) to clicking `verdict-run-it-back` — `VerdictCard`'s always-present tap-button
 * fallback, the same accessible-equivalent path `SwipeBallot`'s own e2e suite favors over raw
 * pointer drags for flow tests that aren't specifically exercising the drag gesture itself (see
 * `golden-loop.spec.ts`'s `pick-yes`/`pick-no` well clicks vs. `swipe-ballot.spec.ts`'s dedicated
 * drag simulation — the gesture math is `useDragCommit`, shared with `SwipeBallot` and already
 * covered there, so it doesn't need re-proving here). The swipe/tap commits immediately (no
 * separate confirm step — that's the whole point of the gesture), so there's no "Yes, request
 * it" click anymore either.
 *
 * `/nemesis` is SSR-gated (`auth()` + redirect to `/claim` for anyone without a real session —
 * unlike `/duo`, which resolves identity client-side and can be exercised with plain
 * `page.route` mocking, see `duo.spec.ts`'s own header). Reaching it needs a REAL Auth.js
 * session, so this seeds one directly onto an already-`claimed` profile the same way
 * `golden-loop.spec.ts`'s header comment #3 justifies doing this for the claim-completion step:
 * a real `users` + `sessions` row (Auth.js "database" strategy validates by raw
 * `sessions.session_token` equality) with the cookie set on the browser context — no
 * OAuth/magic-link round trip needed since this profile doesn't need to go THROUGH claim, it's
 * already claimed.
 *
 * Season dates are a wide, real-wall-clock-covering range (`2020-01-01`..`2035-12-31`) rather
 * than a fixed date — this repo's `now()` test-clock override only works when `NODE_ENV=test`,
 * but `next start` (this suite's webServer) hard-forces `NODE_ENV=production` (see
 * `golden-loop.spec.ts`'s header comment on `SESSION_COOKIE_NAME`), so the server always reads
 * the REAL wall clock; `nemesis-matchup.spec.ts` (WS5-T4) established this same wide-season
 * pattern for the identical reason.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import {
  connect,
  nemesisPairings,
  profiles,
  rematchRequests,
  seasons,
  sessions,
  users,
  type Db,
} from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

// See `golden-loop.spec.ts`'s header comment on this exact constant — `next start` always runs
// with `NODE_ENV=production`, so `useSecureCookies` (`apps/web/auth.ts`) is always true here.
const SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

/** A wide-enough season to cover "today" on whatever real calendar date this suite runs. */
async function seedWideSeason(): Promise<string> {
  const [season] = await db
    .insert(seasons)
    .values(buildSeason({ startsOn: '2020-01-01', endsOn: '2035-12-31' }))
    .returning();
  return season!.id;
}

/** An already-`claimed` profile with a real backing `users` row and a real, directly-seeded
 * Auth.js session cookie value — see file header for why this bypasses the claim UI entirely. */
async function seedClaimedProfileWithSession(handle: string): Promise<{ profileId: string; sessionToken: string }> {
  const userId = randomUUID();
  const email = `nemesis-rematch-${randomUUID()}@example.test`;
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

test.describe('/nemesis rematch-request flow (§8.4 step 0, §9.2, real Postgres + HTTP)', () => {
  test('requesting a rematch against a past nemesis hits the real API and flips to the pending state', async ({
    page,
    context,
  }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(`E2E Viewer ${unique}`);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];

    // A terminal (completed) pairing this season — "a past nemesis this season" (§9.2).
    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: '2026-06-01' }));

    // `domain`+`path` (not `url`) — Chromium's CDP `Storage.setCookies` rejects a `__Secure-`
    // prefixed cookie set via `url` ("Invalid cookie fields"), verified empirically by
    // `golden-loop.spec.ts`'s identical cookie-seeding step; `domain`+`path` round-trips.
    await context.addCookies([
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

    await page.goto('/nemesis');
    // Scoped to the history row's link specifically — SW10-T2's verdict card ALSO prints the
    // opponent's handle in its own copy line, so a bare `getByText` now matches both.
    await expect(page.getByRole('link', { name: opponent!.handle as string })).toBeVisible();

    // SW10-T2: `VerdictCard`'s always-present "Run it back" tap button is the accessible
    // equivalent of a right-swipe (D-SW9 affirmative-right) — it fires the same
    // `POST /rematch-requests` `RematchPanel`'s old plain button used to.
    await expect(page.getByTestId('verdict-card')).toBeVisible();
    await page.getByTestId('verdict-run-it-back').click();

    await expect(page.getByTestId('rematch-pending')).toBeVisible();
    await expect(page.getByTestId('rematch-pending')).toContainText('Rematch requested');

    // Confirms the click actually persisted through the real API, not just a client-side
    // optimistic render.
    const [row] = await db.select().from(rematchRequests).where(eq(rematchRequests.requesterProfileId, viewerId));
    expect(row?.targetProfileId).toBe(opponentId);
    expect(row?.status).toBe('open');
  });

  test('an incoming rematch request shows accept/decline, and accepting confirms it', async ({
    page,
    context,
  }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(`E2E Viewer2 ${unique}`);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Opponent2 ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];

    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: '2026-06-01' }));
    // The opponent already requested a rematch against the viewer — an OPEN incoming request.
    await db.insert(rematchRequests).values({
      id: randomUUID(),
      requesterProfileId: opponentId,
      targetProfileId: viewerId,
      seasonId,
      status: 'open',
    });

    await context.addCookies([
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

    await page.goto('/nemesis');
    await expect(page.getByTestId('rematch-incoming')).toBeVisible();
    await expect(page.getByTestId('rematch-incoming')).toContainText('wants a rematch');

    await page.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByTestId('rematch-accepted')).toBeVisible();
  });
});
