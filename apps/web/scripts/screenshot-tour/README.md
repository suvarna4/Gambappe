# Screenshot tour

Dev-only tooling that seeds a realistic demo dataset and captures full-page screenshots
of every user-facing route — used for design reviews (route-by-route "what does the app
actually look like today"). Nothing here ships or runs in CI.

## Usage

Requires local Postgres + Redis (docker compose, or native services), migrations applied
(`pnpm db:migrate && pnpm db:seed`), and a dev server running with the flags from
`apps/web/playwright.config.ts` (`FLAG_NEMESIS`, `FLAG_DUO_QUEUE`, `AUTH_SECRET`, dummy
venue bases, …).

```bash
export DATABASE_URL=postgres://receipts:receipts@localhost:5432/receipts

# 1. Seed demo content: today's open daily, yesterday's revealed daily,
#    named profiles (fox-4821, wolf-1180, otter-7742), an active nemesis
#    pairing, and a tier-III duo. Prints the ids/slugs the shooters need.
npx tsx scripts/screenshot-tour/seed-fixtures.mts

# 2. Anonymous pass over every route (mobile viewport; /dev/ui + /admin desktop).
PAIRING_ID=<from step 1> DUO_ID=<from step 1> SHOT_DIR=/tmp/screens \
  npx tsx scripts/screenshot-tour/shoot-routes.mts

# 3. Signed-in pass (auth-gated routes: /nemesis*, /duo, /settings).
#    Mints an Auth.js database-strategy session for fox-4821, prints the token.
npx tsx scripts/screenshot-tour/seed-session.mts
SESSION_TOKEN=<from above> npx tsx scripts/screenshot-tour/shoot-authed.mts
```

Notes:

- The shooters use the Playwright API against the preinstalled Chromium
  (`executablePath: /opt/pw-browsers/chromium`) — adjust or drop `executablePath` where a
  matching Playwright browser install exists.
- The session cookie name follows `lib/auth-cookies.ts`: unprefixed `authjs.session-token`
  against a dev server, `__Secure-`-prefixed in production builds.
- Seeds are additive (no wipes) and use `@receipts/db/testing` factories; safe on a dev
  database. Re-runs detect the existing fixtures (by the `fox-4821` profile) and just
  print their identifiers instead of inserting duplicates.
