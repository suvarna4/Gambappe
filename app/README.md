# Receipts — Hackathon MVP

A social layer on regulated prediction markets: timestamped, price-stamped
picks, a synchronized daily reveal, and a lightweight nemesis rivalry —
built per `../receipts-design-doc.md` §16 (the self-contained MVP plan).
See `DEMO.md` for the live demo script.

## What this is

One Next.js 15 app, no monorepo, no worker process, no Redis. A single
idempotent cron-tick endpoint drives the whole lifecycle
(open → lock → grade → reveal). Every invariant in the design doc's §1.3
(no money, no leaked results before the synchronized reveal, no crowd
split before lock, 18+ gate) is enforced and covered by tests — see
`src/**/*.test.ts`.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL at minimum
npx drizzle-kit migrate
pnpm dev
```

Open http://localhost:3000, then http://localhost:3000/admin to curate a
question against the FakeVenue adapter (paste any `venueMarketId`, e.g.
`fake:my-market` — it auto-registers a fixture). No Google OAuth
credentials are required for local dev: `/api/claim/start` falls back to
a dev sign-in screen when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are unset.

## Testing

```bash
pnpm test              # unit + integration (needs a reachable Postgres)
pnpm build              # typecheck + lint + production build
node scripts/rehearsal.mjs   # end-to-end smoke test over HTTP (needs `pnpm dev` running)
```

Integration tests run against `DATABASE_URL` (default: a local `receipts_test`
database) and truncate between cases — point it at a disposable database.

## Layout

Mirrors the full design's package boundaries so extraction to a monorepo
later is mechanical:

- `src/shared/` — constants, time/ET helpers, event allowlist
- `src/db/` — Drizzle schema, `grade.ts` (the grading state machine),
  `lifecycle.ts` (the cron sweep), `nemesis.ts`
- `src/engine/` — pure functions only: streaks/percentile, nemesis
  matcher, narration templates
- `src/venues/` — `VenueAdapter` interface + Kalshi + FakeVenue
  (imported only by server/admin code, never by page components)
- `src/server/` — principal/session resolution, serializers (the one
  allowlist all public payloads go through), rate limiting, admin gate
- `src/app/` — pages + API route handlers

## Deploying

Vercel + any managed Postgres (e.g. Neon). `vercel.json` wires
`/api/cron/tick` to Vercel Cron every minute (it authenticates via the
`Authorization: Bearer $CRON_SECRET` header Vercel sends automatically).
Set every variable in `.env.example`, plus real `AUTH_GOOGLE_ID`/
`AUTH_GOOGLE_SECRET` to disable the dev sign-in fallback.
