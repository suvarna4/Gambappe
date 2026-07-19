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

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
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
