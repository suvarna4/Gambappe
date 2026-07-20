/**
 * WS5-T5 E2E: the rematch-request flow on `/nemesis` (design doc §8.4 step 0, §9.2
 * `POST /rematch-requests*`) through REAL HTTP routes against real Postgres — `RematchPanel`
 * (inside `NemesisHistoryList`, or promoted directly onto `/nemesis` as primary content, see
 * below) now calls `/api/v1/rematch-requests*` instead of the deleted mock backend
 * (`lib/nemesis/mock-api.ts`, see `/nemesis/page.tsx`'s header for the handoff).
 *
 * Structural redesign (design-diff audit): `/nemesis` is now a state machine
 * (`selectNemesisPageState`, `lib/nemesis/page-state.ts`) that shows exactly one of
 * assignment/verdict/empty as primary content. Every pairing seeded in this file omits a
 * `status` override, so `buildNemesisPairing`'s default (`'completed'`) applies — with no active
 * pairing and this as the viewer's only history entry, `getCurrentPairingForProfile` returns
 * `null` and this pairing becomes the promoted "verdict state" entry (`NemesisHeadToHeadBanner`
 * + `RematchPanel`/`VerdictCard`, rendered directly on `/nemesis`, not nested inside a history
 * row) — which is exactly the flow this suite already exercised, just relocated on the page.
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
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';
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

/**
 * A Monday `week_start` (`YYYY-MM-DD`) whose `nemesis:conclude` instant (that week's Sunday
 * 22:00 ET) is safely in the past but still inside `page-state.ts`'s `VERDICT_FRESH_WINDOW_MS`
 * (8 days) of REAL current time. This suite's own header explains why every pairing here omits a
 * `status` override to become the promoted "verdict state" entry — that promotion (`lib/nemesis/
 * page-state.ts`'s `selectNemesisPageState`) requires the week to be genuinely recent, not just
 * non-cancelled, so (unlike the wide-real-clock-covering SEASON dates just above, which only
 * need to CONTAIN whenever "now" happens to be) this can't be a fixed calendar date — copied
 * verbatim from `nemesis-page-states.spec.ts`'s identical helper (same rationale documented
 * there in full).
 */
function recentFreshWeekStart(): string {
  const now = new Date();
  const isoDow = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // Mon=1..Sun=7
  const daysSinceThisMonday = isoDow - 1;
  const lastWeekMonday = new Date(now);
  lastWeekMonday.setUTCDate(now.getUTCDate() - daysSinceThisMonday - 7);
  return lastWeekMonday.toISOString().slice(0, 10);
}

/** Drags `card` by `dxRatio` × its own width and releases — same shape as
 * `swipe-ballot.spec.ts`'s helper, reused here (fable review of PR #84) to prove
 * `VerdictSwipeCard`'s ACTUAL drag→action mapping, not just the always-present tap-button
 * fallback the other tests in this file drive. The shared gesture MATH (`useDragCommit`) is
 * already covered by `swipe-ballot.spec.ts`; what wasn't covered anywhere is this component's
 * own `onCommit` wiring (right → `onRunItBack`, left → `onNewFate`) — a swapped mapping here
 * would ship a "Run it back" swipe that silently does nothing, or a "New fate" swipe that
 * accidentally files a real rematch request. */
async function dragCard(page: Page, card: Locator, dxRatio: number): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  if (!b) throw new Error('card has no bounding box');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const target = cx + b.width * dxRatio;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx + (target - cx) * (i / 12), cy);
  }
  await page.mouse.up();
}

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

const WIDE_SEASON_STARTS_ON = '2020-01-01';
const WIDE_SEASON_ENDS_ON = '2035-12-31';

/**
 * A wide-enough season to cover "today" on whatever real calendar date this suite runs —
 * find-or-create on the exact `(kind, starts_on, ends_on)` triple, so every test in this file
 * (and every prior local run of it) converges on ONE canonical row instead of each minting its
 * own.
 *
 * Fable review of PR #84: this file's tests share ONE local Postgres across many runs (unlike
 * CI's fresh-per-job instance), and `getNemesisSeasonCoveringDate` picks `ORDER BY starts_on ASC
 * LIMIT 1` with no secondary tiebreaker — a real production invariant (nemesis:window-roll never
 * runs two overlapping seasons at once). Every prior version of this helper inserted a NEW row
 * per call, which violates that invariant the moment two exist: `requestRematch`'s subsequent
 * `wasNemesisThisSeason` check requires an EXACT `season_id` match, so as soon as a second wide
 * season exists, the lookup can resolve to a DIFFERENT test's row than the one this test's own
 * pairing was actually seeded under, and the request 400s with "target must be a past nemesis
 * this season" — reproduced locally after this file accumulated leftover rows from earlier runs
 * (a randomized-`starts_on` per-call attempt was tried and rejected: it makes collisions between
 * two calls unlikely, but does nothing to guarantee any ONE call's row is the specific one
 * `ORDER BY starts_on ASC LIMIT 1` returns among several). Find-or-create removes the ambiguity
 * at the root — there is only ever one row to find.
 *
 * Fable review round 2 of PR #84: find-or-create alone isn't enough — `playwright.config.ts` sets
 * `fullyParallel: true` with no worker cap, all four tests in this file call `seedWideSeason` at
 * suite start, and `seasons` has no unique index on `(kind, starts_on, ends_on)`, so two workers
 * can both SELECT-miss in the same window and both INSERT — recreating the exact duplicate-season
 * bug this helper exists to prevent. `pg_advisory_xact_lock` serializes callers on a fixed key,
 * scoped to the transaction so it auto-releases at commit/rollback and stays correct under
 * connection pooling (unlike a session-level `pg_advisory_lock`, which needs the same connection
 * for lock and unlock — not guaranteed across a pool).
 */
const WIDE_SEASON_LOCK_KEY = 727_002_026; // arbitrary, stable — only needs to be unique among this repo's advisory-lock keys (there are none others yet).

async function seedWideSeason(): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${WIDE_SEASON_LOCK_KEY})`);
    const [existing] = await tx
      .select()
      .from(seasons)
      .where(
        and(
          eq(seasons.kind, 'nemesis'),
          eq(seasons.startsOn, WIDE_SEASON_STARTS_ON),
          eq(seasons.endsOn, WIDE_SEASON_ENDS_ON),
        ),
      )
      .limit(1);
    if (existing) return existing.id as string;
    const [season] = await tx
      .insert(seasons)
      .values(buildSeason({ startsOn: WIDE_SEASON_STARTS_ON, endsOn: WIDE_SEASON_ENDS_ON }))
      .returning();
    return season!.id as string;
  });
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
    const viewerHandle = `E2E Viewer ${unique}`;
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(viewerHandle);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];

    // A terminal (completed) pairing this season — "a past nemesis this season" (§9.2).
    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: recentFreshWeekStart() }));

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
    // Structural redesign: with no active pairing and this pairing as the only (non-cancelled)
    // history entry, `/nemesis` promotes it into the primary "verdict state" (`selectNemesisPageState`,
    // `lib/nemesis/page-state.ts`) rather than rendering it as a row inside the history list below —
    // so it's asserted on the verdict-state container, not a history-row link.
    await expect(page.getByTestId('nemesis-verdict-state')).toBeVisible();

    // SW10-T2: `VerdictCard`'s always-present "Run it back" tap button is the accessible
    // equivalent of a right-swipe (D-SW9 affirmative-right) — it fires the same
    // `POST /rematch-requests` `RematchPanel`'s old plain button used to.
    await expect(page.getByTestId('verdict-card')).toBeVisible();

    // Design-diff gap fix: the head-to-head banner above the verdict card needs the viewer's
    // own handle, threaded server-side from `app/nemesis/page.tsx`'s already-fetched `profile`
    // row (no extra DB round trip) — this is the one real, end-to-end proof that plumbing
    // actually reaches the rendered page, not just a unit test's hand-built props.
    await expect(page.getByTestId('head-to-head-banner')).toBeVisible();
    await expect(page.getByTestId('head-to-head-banner')).toContainText(viewerHandle);
    await expect(page.getByTestId('head-to-head-banner')).toContainText(opponent!.handle as string);

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

    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: recentFreshWeekStart() }));
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

  test('a real right-drag (not just the tap fallback) fires "Run it back" and requests a rematch', async ({
    page,
    context,
  }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(`E2E Dragger ${unique}`);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Drag Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];
    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: recentFreshWeekStart() }));

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
    const card = page.getByTestId('verdict-card-face');
    await expect(card).toBeVisible();
    await dragCard(page, card, 0.6);

    await expect(page.getByTestId('rematch-pending')).toBeVisible();
    const [row] = await db.select().from(rematchRequests).where(eq(rematchRequests.requesterProfileId, viewerId));
    expect(row?.targetProfileId).toBe(opponentId);
    expect(row?.status).toBe('open');
  });

  test('a real left-drag fires "New fate" — no rematch request is ever filed', async ({ page, context }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(`E2E LeftDrag ${unique}`);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E LeftDrag Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];
    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: recentFreshWeekStart() }));

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
    const card = page.getByTestId('verdict-card-face');
    await expect(card).toBeVisible();
    await dragCard(page, card, -0.6);

    // "New fate" is a client-only pass (no existing request to decline in this terminal state,
    // per the doc) — the proof is negative: no row was ever created, distinguishing this from a
    // swapped-direction bug that would fire "Run it back" instead.
    await page.waitForTimeout(300);
    const rows = await db.select().from(rematchRequests).where(eq(rematchRequests.requesterProfileId, viewerId));
    expect(rows).toHaveLength(0);
  });
});
