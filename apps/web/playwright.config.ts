/**
 * Playwright E2E config (WS0-T1 wiring; §17.1 E2E runs chromium against the dev stack with
 * MockVenueAdapter). Assumes `next build` has run; starts `next start` itself.
 */
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// WS10-T1 admin-auth.spec.ts needs a known stopgap token + allowlist; harmless test-only
// defaults so CI/local runs don't need to export these just to run e2e (webServer inherits
// process.env as-is, so setting them here before defineConfig is enough).
process.env.ADMIN_STOPGAP_TOKEN ??= 'e2e-test-stopgap-token';
process.env.ADMIN_STOPGAP_IP_ALLOWLIST ??= '127.0.0.1';
// WS7-T7 duo.spec.ts exercises `/duo`, `/duos/[id]`, `/ladder` — all behind the `duo_queue`
// flag (§4.6), same as every duo API route (default off, §19.5 "Gate P1.5: duo behind flag
// until one internal ladder window completes cleanly"). Same inherit-into-webServer mechanism
// as `ADMIN_STOPGAP_TOKEN` above.
process.env.FLAG_DUO_QUEUE ??= 'true';
// WS14-T1 golden-loop.spec.ts calls the real `POST /internal/revalidate` (§9.2) to force fresh
// ISR after directly advancing question state (lock/reveal) via repository calls instead of the
// real worker cron — same "harmless test-only default" rationale as the stopgap token above.
process.env.INTERNAL_API_SECRET ??= 'e2e-test-internal-secret';
// Auth.js requires `secret` to be configured (`auth.ts`) — without it, `auth()` logs
// `MissingSecret` and silently resolves every request as unauthenticated instead of throwing,
// which every OTHER e2e spec never notices (none of them depend on `auth()` actually resolving
// a real session — they're anonymous/ghost-only scenarios where "no session" is the expected
// outcome anyway). `golden-loop.spec.ts` is the first spec that seeds a real Auth.js database
// session and needs `auth()` to actually recognize it (the claim-completion step) — CI's e2e
// job doesn't set `AUTH_SECRET` (`.github/workflows/ci.yml`), so without this default the claim
// step deterministically renders the pre-auth `ClaimEntry` instead of `ClaimCompletion` there,
// even though it's invisible locally if you happen to always export `AUTH_SECRET` by hand.
process.env.AUTH_SECRET ??= 'e2e-test-auth-secret-e2e-test-auth-secret';
// `apps/web/lib/venues.ts`'s `defaultVenueAdapters()` constructs a real `KalshiAdapter`/
// `PolymarketAdapter` eagerly (§6.2 step 4's synchronous price-fetch fallback) — construction
// itself throws when these base-URL env vars are unset, regardless of whether the fetch is ever
// reached. `golden-loop.spec.ts` primes the real Redis price cache before placing its pick
// (staying off the venue-adapter path entirely, both for realism — production keeps this cache
// warm via `venue:price-tick` — and to avoid a live-network-call's timing variance counting
// against §19.3's <1% flake-rate AC), but these still guard the OTHER rungs of the ladder any
// future real (non-`page.route`-mocked) pick placement would fall through to on a cache miss:
// without dummy values, construction itself 500s before ever reaching the DB-fallback rung.
// Port 1 is always closed — a fetch that does reach it fails fast (ECONNREFUSED) rather than
// hanging for the venue-fetch's 2s timeout.
process.env.KALSHI_API_BASE ??= 'http://127.0.0.1:1';
process.env.POLYMARKET_GAMMA_BASE ??= 'http://127.0.0.1:1';
process.env.POLYMARKET_CLOB_BASE ??= 'http://127.0.0.1:1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // WS8-T2's share sheet calls `navigator.clipboard.writeText` on copy-link — Chromium
    // denies clipboard-write by default in a headless/CI context without an explicit grant.
    permissions: ['clipboard-read', 'clipboard-write'],
    // Sandboxed/dev environments can point at a system chromium instead of downloading
    // (CI uses the standard pre-installed browsers, §17.3).
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
