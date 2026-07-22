# Deploy activation runbook

How to take Gambappe from empty cloud accounts to a live deploy. The deploy **pipeline already
exists** — `.github/workflows/auto-deploy-staging.yml` (WS15-T10) migrates Neon, redeploys the Fly
worker, and deploys web to Vercel every 15 min (and on manual dispatch) whenever `main` moves. This
guide is just the one-time **activation**: provision the four services, set runtime env, and add the
three repo secrets that arm the pipeline.

Architecture (design-doc §18): **web** (`apps/web`, Next.js) → Vercel · **worker** (`apps/worker`,
pg-boss) → Fly.io (1 machine) · **Postgres** → Neon · **Redis** → Upstash.

> **Secrets stay in the platform dashboards.** Paste connection strings / tokens into Vercel, Fly,
> Neon, Upstash, and GitHub — never into chat or the repo. `.env.example` enumerates every var.

---

## 1. Neon (Postgres) — two URLs

Create a project (pick a region near your Vercel/Fly region). Neon gives two connection strings:

- **Pooled** (host contains `-pooler`) → the app runtime `DATABASE_URL` (Vercel + Fly). Serverless-safe.
- **Direct** (host without `-pooler`) → migrations `STAGING_DATABASE_URL` (GitHub secret). DDL over the
  pooler's transaction pooling can fail, so migrations must use the direct host.

Keep `?sslmode=require` on both. Free tier auto-suspends when idle — fine for staging.

## 2. Upstash (Redis) — one URL

Create a Redis database (TLS on). Copy the `rediss://default:<password>@<host>:6379` URL → `REDIS_URL`
(Vercel + Fly). `ioredis` auto-enables TLS for `rediss://`. Redis is disposable (§2.2), so free-tier
command/connection limits are acceptable for low traffic.

## 3. Generate the app secrets (once)

```bash
for k in AUTH_SECRET GHOST_COOKIE_SECRET SHARE_TOKEN_SECRET INTERNAL_API_SECRET \
         WALLET_HASH_SECRET UNSUB_TOKEN_SECRET; do
  echo "$k=$(openssl rand -base64 32)"
done
```

Save the output somewhere private. `INTERNAL_API_SECRET` must be the **same value** on web and worker
(the worker calls the web's `/internal/revalidate`).

## 4. Vercel (web)

If reusing the existing project (`gambappe.vercel.app`): just set env vars. To use **your own** project:
import the repo, set **Root Directory = `apps/web`**, framework Next.js (build command auto-detected);
then update the workflow env in step 7.

Set **Production** env vars (Project → Settings → Environment Variables):

- **Required:** `DATABASE_URL` (Neon **pooled**), `REDIS_URL` (Upstash), `NEXT_PUBLIC_APP_URL` (your prod
  URL, e.g. `https://gambappe.vercel.app`), `GHOST_COOKIE_SECRET`, `SHARE_TOKEN_SECRET`, `AUTH_SECRET`,
  `INTERNAL_API_SECRET`, `WALLET_HASH_SECRET`, `UNSUB_TOKEN_SECRET`.
- **Feature flags — turn the deck on:** `FLAG_SWIPE_BALLOT=true`, `FLAG_TOPIC_MARKETS=true` (the mixed
  stack deck needs both). Optionally `FLAG_CALLOUTS=true`, `FLAG_NEMESIS=true`, `FLAG_DUO_QUEUE=true`,
  `FLAG_DEPARTURES_BOARD=true` for the rest of the journeys surfaces. All default **off**.
- **Optional (features degrade if absent):** OAuth (`AUTH_GOOGLE_ID/SECRET`, `AUTH_TWITTER_ID/SECRET`),
  email (`RESEND_API_KEY`, `EMAIL_FROM`), venue data (`KALSHI_API_BASE`, `POLYMARKET_GAMMA_BASE`,
  `POLYMARKET_CLOB_BASE`, `POLYMARKET_DATA_BASE`, `POLYGON_RPC_URL`), web push (`VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`), `SENTRY_DSN`, admin curation (`ADMIN_STOPGAP_TOKEN`, `ADMIN_STOPGAP_IP_ALLOWLIST`).

> Vercel bakes env at deploy time — after changing a var, redeploy (step 8) for it to take effect.

## 5. Fly (worker)

```bash
flyctl auth login
flyctl apps create gambappe-worker           # if you rename it, update FLY_APP in the workflow (step 7)
flyctl secrets set --app gambappe-worker \
  DATABASE_URL='<neon pooled>' \
  REDIS_URL='<upstash rediss url>' \
  INTERNAL_API_SECRET='<same value as web>' \
  NEXT_PUBLIC_APP_URL='https://<your prod url>' \
  # + any venue bases and VAPID_* you set on web (the worker fetches venue prices and sends push)
flyctl deploy --app gambappe-worker --dockerfile apps/worker/Dockerfile .
```

The first `flyctl deploy` **creates the machine**. The auto-deploy workflow then *updates* that existing
machine on each `main` change (1 shared CPU / 512 MB, restart=always) — so the machine must exist first.

## 6. Migrations + optional seed (first time)

The workflow runs migrations, but you can run the first one directly (uses the Neon **direct** URL):

```bash
DATABASE_URL='<neon DIRECT url>' pnpm --filter @receipts/db db:migrate
# optional: season + placement fixtures (no daily question)
DATABASE_URL='<neon DIRECT url>' pnpm --filter @receipts/db db:seed
```

There's no "today" daily/topic content out of the box — curate questions via the admin route
(`ADMIN_STOPGAP_TOKEN`) or a venue sync once the app is up.

## 7. GitHub repo secrets (arm the pipeline)

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `STAGING_DATABASE_URL` | Neon **direct** URL (migrations) |
| `FLY_API_TOKEN` | `flyctl tokens create deploy` |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |

If you created your **own** Vercel project (not the collaborator's), edit
`.github/workflows/auto-deploy-staging.yml` env: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (from
`vercel link` or project settings), `FLY_APP` (if renamed), and `HEALTH_URL` (your prod URL).

## 8. Deploy

- **Manual:** Actions → *auto-deploy staging* → **Run workflow** (`workflow_dispatch`).
- **Automatic:** within 15 min of any `main` push.

Each run: migrate Neon → build+push the worker image to Fly & update the machine → `vercel deploy --prod`
→ health-check. Each leg no-ops with a notice if its secret is missing, so you can activate them
incrementally.

## 9. Verify

- `curl https://<your prod url>/api/health` → `200` (both stores answered).
- Open `/` — with `FLAG_SWIPE_BALLOT` + `FLAG_TOPIC_MARKETS` on you get the mixed stack deck.
- `flyctl logs --app gambappe-worker` → pg-boss started, jobs scheduled.

---

## Env var placement (quick reference)

| Var | Vercel (web) | Fly (worker) | GitHub secret |
|---|:---:|:---:|:---:|
| `DATABASE_URL` (Neon pooled) | ✅ | ✅ | — |
| `STAGING_DATABASE_URL` (Neon direct) | — | — | ✅ (migrations) |
| `REDIS_URL` (Upstash) | ✅ | ✅ | — |
| `INTERNAL_API_SECRET` (same on both) | ✅ | ✅ | — |
| `NEXT_PUBLIC_APP_URL` | ✅ | ✅ | — |
| `GHOST_COOKIE_SECRET`, `SHARE_TOKEN_SECRET`, `AUTH_SECRET`, `WALLET_HASH_SECRET`, `UNSUB_TOKEN_SECRET` | ✅ | — | — |
| `FLAG_*` (features) | ✅ | ✅ (worker-relevant ones) | — |
| venue bases, `VAPID_*` | ✅ | ✅ | — |
| OAuth, `RESEND_API_KEY`, `SENTRY_DSN`, admin tokens | ✅ | — | — |
| `VERCEL_TOKEN`, `FLY_API_TOKEN` | — | — | ✅ |

## Gotchas

- **Pooled vs direct**: runtime = pooled; migrations = direct. Mixing them up = migrations hang / runtime connection exhaustion.
- **Flags are env-baked**: changing a flag on Vercel needs a redeploy; the Fly machine-update re-snapshots secrets so worker flag changes ride the next deploy.
- **No Vercel cron**: all scheduling lives in pg-boss (the worker) — single scheduler, single truth (§18). Don't add Vercel cron.
- **Backups**: Neon PITR (7 days). Redis is disposable.
</content>
