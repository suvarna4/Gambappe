/**
 * WS24-T1 (journeys-plan §5, STRETCH) · Flag-off regression for the `departures_board` skin.
 *
 * The board is a flagged stretch pilot (`departures_board`, default OFF, and NOT flipped on in
 * `playwright.config.ts`), so across the whole e2e run `/sweat` must stay byte-identical to
 * WS19-T2: the paper `SweatRow` list, never the arrivals board. This file proves exactly that —
 * a real ghost with a pending pick sees the paper `sweat-list`/`sweat-row` and NO
 * `departures-board`. The flag-ON board rendering itself is proven without a live server flip by
 * `test/departures-board.test.tsx` (the component) and the `/dev/ui` gallery tile
 * (`gallery-departures-board`, content + visual specs) — turning the flag on globally here would
 * instead break WS19-T2's own `sweat.spec.ts`, which is why the gate is asserted OFF.
 *
 * NOTE: first run is CI (no browser/CDN in the sandbox). Content assertions only — this file adds
 * no screenshot baseline (the board's baselines are the two `/dev/ui` tiles). Seeds a real ghost
 * profile + pending pick directly into Postgres, mirroring `sweat.spec.ts`, so the page's own
 * `resolveViewerIdentity` resolves the `rcpt_gid` cookie the same way a route handler would.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import {
  buildGhostCookieValue,
  generateGhostSecret,
  GHOST_COOKIE_NAME,
  hashGhostSecret,
} from '../lib/ghost-cookie';
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

async function seedGhostWithPosition(): Promise<{ profileId: string; secret: string }> {
  const unique = randomUUID();
  const secret = generateGhostSecret();
  const profile = buildProfile({
    handle: `Board ${unique}`,
    slug: `board-${unique}`,
    ghostSecretHash: hashGhostSecret(secret),
  });
  await db.insert(profiles).values(profile);

  const market = buildMarket({
    venueMarketId: `KX-BOARD-${unique}`,
    status: 'open',
    closeTime: new Date(Date.now() + 60 * 60_000), // < 2h → LIVE
    yesPrice: 0.7,
  });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    slug: `board-${unique}`,
    questionDate: null,
    status: 'locked',
    headline: 'Board flag-off regression headliner',
  });
  await db.insert(questions).values(question);
  await db.insert(picks).values(
    buildPick(question.id as string, profile.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.6,
      result: 'pending',
    }),
  );
  return { profileId: profile.id as string, secret };
}

test.describe('WS24-T1 /sweat — departures_board OFF (byte-identical paper path)', () => {
  test('a ghost with a pending pick sees the paper SweatRow list, never the arrivals board', async ({
    page,
  }) => {
    const { profileId, secret } = await seedGhostWithPosition();

    await page.context().addCookies([
      {
        name: GHOST_COOKIE_NAME,
        value: buildGhostCookieValue(profileId, secret),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/sweat');

    // The WS19-T2 paper path renders.
    await expect(page.getByTestId('sweat-list')).toBeVisible();
    await expect(page.getByTestId('sweat-row').first()).toBeVisible();

    // The flagged board never renders with the flag off.
    await expect(page.getByTestId('departures-board')).toHaveCount(0);
    await expect(page.getByTestId('departures-row')).toHaveCount(0);
  });
});
