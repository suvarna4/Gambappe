/**
 * WS7-T9 (Settings UI) E2E: pause nemesis, notifications, deletion (type-handle confirm) — the
 * exact AC from the design doc's §19 WBS row. `GET /api/v1/me`, `PATCH /api/v1/me/settings`, and
 * `DELETE /api/v1/me` are intercepted via Playwright route mocking (all three routes are real and
 * merged, but mocking keeps this test deterministic and independent of seeding a real claimed
 * account/session — the same rationale `question-page.spec.ts` uses for its pick/undo flow).
 */
import { expect, test } from '@playwright/test';

const CLAIMED_ME_BODY = {
  data: {
    profile: {
      profile_id: '018f1e2b-0000-7000-8000-0000000000c1',
      handle: 'Otter #4821',
      slug: 'otter-4821',
      kind: 'claimed',
      status: 'active',
      handle_is_generated: true,
      created_at: '2026-07-01T00:00:00Z',
      claimed_at: '2026-07-02T00:00:00Z',
      age_attested: true,
      timezone: null,
      streak: { current: 3, best: 5, freeze_bank: 1, last_counted_date: '2026-07-18' },
      win_streak: { current: 2, best: 4 },
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
      graded_picks: 12,
      nemesis_required: 5,
      duo_required: 10,
      nemesis_eligible: true,
      duo_eligible: true,
    },
    claim: { claimed: true },
  },
};

const GHOST_ME_BODY = {
  data: {
    ...CLAIMED_ME_BODY.data,
    profile: { ...CLAIMED_ME_BODY.data.profile, kind: 'ghost', claimed_at: null },
    claim: { claimed: false },
  },
};

test.describe('settings page (§9.2, §9.4, WS7-T9)', () => {
  test('not claimed (ghost): shows the claim-required notice + inline claim entry, not the settings form', async ({
    page,
  }) => {
    await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: GHOST_ME_BODY }));

    await page.goto('/settings');
    await expect(page.getByTestId('settings-not-claimed')).toBeVisible();
    await expect(page.getByTestId('claim-entry')).toBeVisible();
    await expect(page.getByTestId('settings-ready')).not.toBeVisible();
  });

  test('claimed: renders current settings and toggling pause-nemesis PATCHes exactly that field', async ({
    page,
  }) => {
    await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: CLAIMED_ME_BODY }));

    let patchBody: unknown;
    await page.route('**/api/v1/me/settings', async (route) => {
      patchBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        json: {
          data: {
            settings: { ...CLAIMED_ME_BODY.data.settings, nemesis_paused: true },
            timezone: null,
          },
        },
      });
    });

    await page.goto('/settings');
    await expect(page.getByTestId('settings-ready')).toBeVisible();
    await expect(page.getByTestId('settings-nemesis-paused')).not.toBeChecked();

    // The push preference toggles render even with the `web_push` flag off (this test's env
    // has no FLAG_WEB_PUSH/VAPID_PUBLIC_KEY set) — only PushOptInButton's subscribe action is
    // flag-gated, not the preferences themselves (an already-subscribed profile's push
    // dispatch honors these regardless of the flag).
    await expect(page.getByTestId('settings-push-reveal')).toBeVisible();
    await expect(page.getByTestId('settings-push-nemesis')).toBeVisible();
    await expect(page.getByTestId('settings-push-duo')).toBeVisible();

    // Waiting for the request (not just the resulting checked state) makes the `patchBody`
    // assertion below deterministic rather than racing the mocked route's async fulfillment.
    await Promise.all([
      page.waitForRequest('**/api/v1/me/settings'),
      page.getByTestId('settings-nemesis-paused').click(),
    ]);

    await expect(page.getByTestId('settings-nemesis-paused')).toBeChecked();
    expect(patchBody).toEqual({ nemesis_paused: true });
  });

  test('toggling a notification reverts on a failed save and shows the error', async ({ page }) => {
    await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: CLAIMED_ME_BODY }));
    await page.route('**/api/v1/me/settings', (route) =>
      route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'boom' } } }),
    );

    await page.goto('/settings');
    await expect(page.getByTestId('settings-ready')).toBeVisible();
    await expect(page.getByTestId('settings-email-product')).not.toBeChecked();

    await page.getByTestId('settings-email-product').click();

    await expect(page.getByTestId('settings-save-error')).toBeVisible();
    await expect(page.getByTestId('settings-email-product')).not.toBeChecked();
  });

  test('delete account: confirm button stays disabled until the typed text exactly matches the handle, then deletes', async ({
    page,
  }) => {
    let deleteCalled = false;
    await page.route('**/api/v1/me', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        await route.fulfill({ status: 200, json: { data: { deleted: true } } });
        return;
      }
      await route.fulfill({ status: 200, json: CLAIMED_ME_BODY });
    });

    await page.goto('/settings');
    await expect(page.getByTestId('settings-ready')).toBeVisible();

    await page.getByTestId('settings-delete-open').click();
    await expect(page.getByTestId('settings-delete-confirm-input')).toBeVisible();
    await expect(page.getByTestId('settings-delete-confirm-button')).toBeDisabled();

    await page.getByTestId('settings-delete-confirm-input').fill('not the handle');
    await expect(page.getByTestId('settings-delete-confirm-button')).toBeDisabled();

    await page.getByTestId('settings-delete-confirm-input').fill('Otter #4821');
    await expect(page.getByTestId('settings-delete-confirm-button')).toBeEnabled();

    await page.getByTestId('settings-delete-confirm-button').click();
    await expect(page.getByTestId('settings-delete-done')).toBeVisible();
    expect(deleteCalled).toBe(true);
  });
});
