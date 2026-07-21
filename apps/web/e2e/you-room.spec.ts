/**
 * WS22-T1 (journeys plan §5 / D-J7) E2E: `/you`, the signed-in record-first room. Covers the AC —
 * the claimed and ghost variants both render (viewer-scoped, dynamic), and pins the room's own
 * wiring:
 *   - claimed → the reused `/p/[slug]` stat components (header + stat grid) plus the links out to
 *     the public profile `/p/{slug}` and `/settings`;
 *   - ghost / signed-out → the forming layout with placeholder stats, the reserved save-row slot
 *     (`you-save-row-slot`, filled by WS21-T2) and the ghost-allowed `TopicFollowChips`.
 *
 * Each variant also captures a full-page screenshot snapshot (ghost + claimed) as the visual gate
 * the AC asks for — baselines are generated on the first CI run (`--update-snapshots`), the same
 * flow `dev-ui-visual.spec.ts` documents. `/you` renders no live wall-clock region, so no masking
 * is needed (`toHaveScreenshot` disables animations by default).
 *
 * Session-seeding (`seedClaimedProfileWithSession`, `addSessionCookie`, `SESSION_COOKIE_NAME`)
 * follows `rivals-hub.spec.ts`/`nemesis-page-states.spec.ts`'s header-documented pattern verbatim —
 * a real Auth.js "database"-strategy session on an already-`claimed` profile.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { connect, profiles, sessions, users, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

// `next start` always runs with NODE_ENV=production, so `useSecureCookies` (`apps/web/auth.ts`) is
// always true here — see `rivals-hub.spec.ts`'s header note on this exact constant.
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
): Promise<{ profileId: string; slug: string; sessionToken: string }> {
  const userId = randomUUID();
  const email = `you-room-${randomUUID()}@example.test`;
  await db.insert(users).values({ id: userId, email, ageAttestedAt: new Date() });

  const [profile] = await db
    .insert(profiles)
    .values(buildProfile({ kind: 'claimed', status: 'active', userId, handle }))
    .returning();

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });

  return { profileId: profile!.id as string, slug: profile!.slug as string, sessionToken };
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

test.describe('/you record room (journeys plan §5 / D-J7, real Postgres + HTTP)', () => {
  test('claimed: renders the record with reused stat components and links out', async ({ page }) => {
    const { slug, sessionToken } = await seedClaimedProfileWithSession(`E2E You ${randomUUID()}`);
    await addSessionCookie(page, sessionToken);

    await page.goto('/you');

    await expect(page).toHaveURL(/\/you$/);
    await expect(page.getByTestId('you-claimed')).toBeVisible();
    // The reused `/p/[slug]` stat grid (the "(best N)" streak template it renders).
    await expect(page.locator('main')).toContainText('Streak');
    // Links out to the public profile and settings.
    await expect(page.getByTestId('you-public-profile-link')).toHaveAttribute('href', `/p/${slug}`);
    await expect(page.getByTestId('you-settings-link')).toHaveAttribute('href', '/settings');
    // No forming placeholder / save-row slot in the claimed room.
    await expect(page.getByTestId('you-save-row-slot')).toHaveCount(0);

    await expect(page).toHaveScreenshot('you-claimed.png', { fullPage: true });
  });

  test('ghost / signed-out: forming layout with the save-row slot and topic chips', async ({ page }) => {
    // No session cookie — a fully anonymous visitor gets the forming (ghost) room.
    await page.goto('/you');

    await expect(page).toHaveURL(/\/you$/);
    await expect(page.getByTestId('you-ghost')).toBeVisible();
    // The reserved slot WS21-T2's save row fills (a neutral placeholder for now).
    await expect(page.getByTestId('you-save-row-slot')).toHaveCount(1);
    // The ghost-allowed follow chips render.
    await expect(page.getByTestId('topic-follow-chips')).toBeVisible();
    // It's the forming state, not the claimed record.
    await expect(page.getByTestId('you-claimed')).toHaveCount(0);

    await expect(page).toHaveScreenshot('you-ghost.png', { fullPage: true });
  });
});
