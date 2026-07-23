# xTrace hackathon integration — task breakdown

Status: draft v1, not yet reviewed. Review process + state:
`docs/xtrace-hackathon-review-log.md`. Every edit to this doc must go through
that adversarial review loop until a clean round.

Branch: `claude/xtrace-integration-brainstorm-t1chgj`.

## What we're building

Three user-facing features on one shared memory spine, for the xTrace
hackathon (Gambappe/Receipts is built for this hackathon; the production-lens
constraints in the canonical docs are ours to amend, but the engineering
invariants below are kept because they are correct engineering, not
compliance theater):

1. **Nemesis rivalry companion** — per-user banter on the Rivals hub, grounded
   in cross-user rivalry memory shared via an xTrace group per pairing.
2. **Callout draft assist** — one-tap AI-drafted trash talk riding the
   existing callout share sheet (never stored in-app; WS20-T4's stamps-only
   contract is untouched).
3. **Season wrapped** — a batch-generated narrative recap of a nemesis season
   on `/you`.

Data flow (one direction only):

```
Postgres (verdicts, posts, seasons)
   └─ worker ingest job ──▶ xTrace (facts/episodes, group-scoped)
                                 │ search (fail-open)
Postgres (deterministic stats) ──┤
                                 ▼
                       Claude API generation
                                 │ money-word filter
                                 ▼
                    companion_artifacts (cache)
                                 ▼
                        API routes / panels
```

## Ground rules (binding on every task)

1. **Engine purity (INV-5).** Nothing in `packages/engine` may import from
   `@receipts/companion`, call xTrace, or read `companion_artifacts`. No
   memory-derived value may ever feed scoring, ratings, matchmaking, or
   `narrate()`. CI-checkable: `packages/engine/package.json` gains no new
   dependencies in any task below.
2. **No pre-lock pick leakage (§9.3).** Nothing sent to xTrace, put in a
   prompt, or rendered by these features may reveal a pick side for a
   question whose `lock_at` is in the future. The ingestion task satisfies
   this structurally: it only ingests concluded pairings' verdicts and
   already-mutually-visible thread posts.
3. **Fail-open, never blocking.** xTrace and the Claude API are best-effort
   dependencies. Their failure or slowness must never fail or delay a page
   render, an API route's non-companion behavior, or any existing job. Every
   external call has a timeout; every feature degrades to "panel/button
   absent," never to an error surface.
4. **Deterministic record is authoritative.** Any factual claim in generated
   text (scores, records, streaks) must come from Postgres-derived values
   passed into the prompt and echoed, never from memory retrieval. Memory
   contributes tone, callbacks, and color only. Prompts state this
   explicitly.
5. **Money-word filter (INV-8).** All generated text passes a runtime filter
   for `/\bbet\b|\bstake\b|\bwager\b|\$/i` before storage or render. A line
   that fails is dropped; if nothing survives, the feature renders nothing.
6. **Pseudonymous data only.** Payloads to xTrace and the Claude API may
   contain: profile ids, handles, scores/records, verdict template lines,
   thread post bodies, question headlines, category names. Never: emails,
   user ids (`users.id`), wallet addresses, IPs, tokens/secrets.
7. **Repo conventions.** Flags default **off** in `FLAG_DEFAULTS` (enabled
   per-env via `FLAG_*` vars). All user-facing strings in
   `apps/web/lib/copy.ts`. All timestamps via `now()` from
   `@receipts/core` (never `new Date()`) so `TEST_CLOCK` drives demos.
   Tunable numbers in `packages/core/src/config.ts`, not env. New API
   routes follow the `runRoute` + `ApiError` + zod pattern. `pnpm verify`
   green before every PR. Tasks touching `packages/core` contract files are
   contract-change PRs per design-doc §19.4.

## Task index and dependency order

| Task | Title | Depends on |
|---|---|---|
| XH-T1 | Contracts, flags, config (`packages/core`, contract-change) | — |
| XH-T2 | `@receipts/companion`: xTrace client | XH-T1 |
| XH-T3 | `@receipts/companion`: generation service | XH-T1 |
| XH-T4 | DB: `companion_artifacts` + `companion_ingest_log` + repository | XH-T1 |
| XH-T5 | Worker: rivalry memory ingestion job | XH-T2, XH-T4 |
| XH-T6 | Banter API route + Rivals hub panel | XH-T2, XH-T3, XH-T4 |
| XH-T7 | Callout draft API + share-sheet integration | XH-T2, XH-T3, XH-T4 |
| XH-T8 | Season wrapped: batch job + `/you` panel | XH-T2, XH-T3, XH-T4 |
| XH-T9 | Demo seed script + runbook | XH-T5..T8 |

Demo-critical path: T1 → T2/T3/T4 → T5 → T6 → T9. T7 and T8 are
independently shippable after T4.

---

## XH-T1 — Contracts, flags, config (contract-change PR)

**Goal:** All shared names, types, schemas, flags, and constants the other
tasks consume, defined once in `packages/core`.

**Files:**
- `packages/core/src/flags.ts` — add to `FLAG_DEFAULTS` (all `false`):
  `companion`, `callout_draft`, `season_wrapped`.
- `.env.example` — under `# --- Feature flags ---` add `FLAG_COMPANION`,
  `FLAG_CALLOUT_DRAFT`, `FLAG_SEASON_WRAPPED`. Add a new
  `# --- Companion (xTrace + Claude) ---` group: `XTRACE_API_BASE`
  (default `https://api.production.xtrace.ai`), `XTRACE_API_KEY`,
  `XTRACE_APP_ID` (e.g. `receipts-hackathon`), `ANTHROPIC_API_KEY`.
- `packages/core/src/config.ts` — add (and include in the aggregate
  `CONFIG` object; the snapshot test will need updating):
  - `COMPANION_MODEL = 'claude-opus-4-8'`
  - `COMPANION_MAX_OUTPUT_TOKENS = 1024`
  - `COMPANION_LLM_TIMEOUT_MS = 20_000`
  - `XTRACE_TIMEOUT_MS = 3_000`
  - `XTRACE_MAX_RETRIES = 2`
  - `COMPANION_PROMPT_VERSION = 1`
  - `COMPANION_BANTER_MAX_LINES = 3`
  - `COMPANION_SEARCH_LIMIT = 8` (memories per retrieval)
  - `MONEY_WORD_REGEX_SOURCE = '\\bbet\\b|\\bstake\\b|\\bwager\\b|\\$'`
    (same pattern `apps/web/test/copy.test.ts` pins; the test keeps its own
    literal — intentional duplication, both pinned)
- `packages/core/src/enums.ts` — add registry-style
  `COMPANION_ARTIFACT_KIND = ['banter', 'callout_draft', 'season_recap'] as const`
  and `CompanionArtifactKind` type, mirroring existing enum entries.
- `packages/core/src/ids.ts` — add `zCompanionArtifactId = zId<'CompanionArtifactId'>()`.
- `packages/core/src/schemas/companion.ts` (new; re-export from
  `schemas/index.ts`) — zod schemas:
  ```ts
  export const banterLineSchema = z.object({
    line: z.string().min(1).max(280),
  });
  export const getBanterResponseSchema = z.object({
    banter: z.object({
      lines: z.array(z.string().min(1).max(280)).min(1).max(3),
      generated_at: zTimestamp,
    }).nullable(),           // null = feature degraded/hidden, always 200
  });
  export const draftCalloutBodySchema = z.object({
    target_profile_id: zProfileId,
  }).strict();
  export const draftCalloutResponseSchema = z.object({
    drafts: z.array(z.string().min(1).max(280)).min(1).max(3),
  });
  export const seasonRecapContentSchema = z.object({
    title: z.string().min(1).max(120),
    paragraphs: z.array(z.string().min(1).max(600)).min(1).max(4),
  });
  export const getRecapResponseSchema = z.object({
    recap: seasonRecapContentSchema.extend({ generated_at: zTimestamp }).nullable(),
  });
  ```

**Spec notes:**
- Flag semantics: `companion` gates ingestion job + banter route/panel;
  `callout_draft` gates the draft route/button; `season_wrapped` gates the
  recap job + `/you` panel. Each surface checks its own flag exactly the way
  `callouts` does (route throws `ApiError('NOT_FOUND', …)` when off; server
  component skips rendering).
- Do NOT add these routes to `API_CONTRACT` in `schemas/registry.ts` — the
  journeys-era routes (callouts, stack, topics) are also not in it; follow
  that precedent and keep the registry untouched.

**Acceptance criteria:**
- `pnpm verify` green, including the updated `CONFIG` snapshot test.
- `isFlagEnabled('companion')` returns false with no env, true with
  `FLAG_COMPANION=true` (covered by existing flags test pattern — add cases).
- New schemas exported from `@receipts/core` root and parse/reject the
  obvious valid/invalid payloads (unit tests in `packages/core/test/`,
  following the existing schema test file style).

**Out of scope:** anything importing these (later tasks).

---

## XH-T2 — `@receipts/companion`: xTrace client

**Goal:** A typed, fail-open xTrace REST client, mirroring the
`packages/venues` HTTP-client pattern, that every other task uses for memory
I/O. No other file in the repo may call the xTrace HTTP API directly.

**Files (new package):**
- `packages/companion/package.json` — name `@receipts/companion`,
  `"type": "module"`, private, version 0.0.0. Deps: `zod`,
  `@receipts/core`, `@anthropic-ai/sdk` (used by XH-T3; add here so the
  package.json is written once). Dev deps + scripts (`build`, `typecheck`,
  `test`, `lint`) copied from `packages/venues/package.json`, which is the
  structural template for this whole package (tsconfig extending
  `@receipts/config/tsconfig.package.json`, eslint config, `vitest.config.ts`
  with `test/**/*.test.ts`).
- `packages/companion/src/xtrace/schemas.ts` — zod schemas for the wire
  shapes in Appendix A (only the fields we read): `xtraceMemorySchema`
  (`id`, `type`, `text`, `user_id`, `group_ids`, `score`, `created_at` —
  all except `id`/`type`/`text` nullable/optional), `xtraceSearchResponseSchema`
  (`{ data: xtraceMemorySchema[] }`, passthrough for extra fields),
  `xtraceIngestAcceptedSchema` (`{ id: z.string(), status: z.string() }`,
  passthrough).
- `packages/companion/src/xtrace/client.ts` — exports:
  ```ts
  export interface XtraceClientOptions {
    apiBase: string;          // from env XTRACE_API_BASE
    apiKey: string;           // from env XTRACE_API_KEY
    appId: string;            // from env XTRACE_APP_ID
    timeoutMs?: number;       // default XTRACE_TIMEOUT_MS
    maxRetries?: number;      // default XTRACE_MAX_RETRIES
    fetchImpl?: typeof fetch; // injection for tests, like venues http-client
    logger?: (msg: string, err?: unknown) => void; // default console.warn
  }
  export interface IngestTurn { role: 'user' | 'assistant'; content: string; date?: string }
  export interface IngestArgs {
    userId: string;           // profiles.id
    convId: string;           // see conventions below
    messages: IngestTurn[];
    groupIds?: string[];
    agentId?: string;
  }
  export interface SearchArgs {
    query: string;            // 1–4000 chars
    userId?: string;
    groupIds?: string[];
    include?: Array<'fact' | 'artifact' | 'episode'>;
    limit?: number;           // client-side cap on returned rows, default COMPANION_SEARCH_LIMIT
  }
  export interface XtraceMemory { id: string; type: string; text: string; score: number | null }
  export interface XtraceClient {
    ingest(args: IngestArgs): Promise<boolean>;       // fire-and-forget: POST /v1/memories (no ?wait); true = accepted (202/200)
    search(args: SearchArgs): Promise<XtraceMemory[]>; // POST /v1/memories/search, mode 'retrieve'
  }
  export function createXtraceClient(opts: XtraceClientOptions): XtraceClient;
  export function xtraceClientFromEnv(env?: NodeJS.ProcessEnv): XtraceClient | null;
  //  ^ returns null when XTRACE_API_KEY or XTRACE_APP_ID unset — callers treat null as "memory unavailable"
  ```
- `packages/companion/src/index.ts` — barrel export.

**Spec:**
- **Fail-open contract:** `ingest` and `search` NEVER throw. Any error
  (non-2xx, timeout, network, zod parse failure) → log via `logger` →
  return `false` / `[]`. Retries: only on 429 and 5xx, up to `maxRetries`,
  with full-jitter backoff (copy the `jitteredBackoff` approach from
  `packages/venues/src/http-client.ts`; do not import it — venues is
  venue-scoped — reimplement the ~10-line helper locally).
- Auth header: `x-api-key: <apiKey>`. Always send `app_id: appId` on ingest
  and `app_id` filter on search.
- Timeout via `AbortController`, like the venues client.
- Log messages must never include the API key or full request bodies (post
  bodies are user content); log method, path, status, and error class only.
- **Naming conventions (used by T5–T8, defined here as exported constants):**
  ```ts
  export const pairingGroupId = (pairingId: string) => `pairing:${pairingId}`;
  export const pairingConvId = (pairingId: string, profileId: string) => `pairing:${pairingId}:${profileId}`;
  export const seasonConvId = (seasonId: string, profileId: string) => `season:${seasonId}:${profileId}`;
  ```

**Acceptance criteria (unit tests, injected `fetchImpl` fake — no msw; repo
precedent is fetch injection):**
- ingest sends the documented body shape (assert on captured request:
  `messages`, `user_id`, `conv_id`, `app_id`, `group_ids`) and returns true
  on 202.
- search parses a canned response into `XtraceMemory[]`, caps at `limit`,
  and passes `mode: 'retrieve'`.
- 500 → retried `maxRetries` times then `[]`/`false`; 400 → not retried;
  timeout (fetchImpl that never resolves + abort) → `[]`/`false`;
  malformed JSON → `[]`/`false`. No test throws.
- `xtraceClientFromEnv({})` → null; with all three vars → client.
- `pnpm verify` green (package builds under turbo via the workspace glob).

**Out of scope:** deletion/PATCH endpoints (hackathon cut — noted in
Appendix A), generation (T3).

---

## XH-T3 — `@receipts/companion`: generation service

**Goal:** All Claude API calls behind one typed module: three generation
functions with structured outputs, the money-word filter, and a hard
"deterministic facts are authoritative" prompt contract.

**Files:**
- `packages/companion/src/filter.ts`:
  ```ts
  import { MONEY_WORD_REGEX_SOURCE } from '@receipts/core';
  export const moneyWordRe = new RegExp(MONEY_WORD_REGEX_SOURCE, 'i');
  export function filterLines(lines: string[]): string[]; // drops matches; also trims + drops empty
  ```
- `packages/companion/src/prompts.ts` — pure prompt builders, one per kind.
  Each takes a typed context object and returns `{ system: string; user: string }`.
  Shared preamble requirements (word it once, reuse):
  - "Facts in the RECORD block are authoritative and complete. Never state a
    score, record, streak or result that is not in RECORD. MEMORY items are
    color: callbacks, tone, grudges. If MEMORY contradicts RECORD, RECORD
    wins."
  - "Never mention money, betting, stakes, wagers, dollar amounts, or odds
    as prices."
  - "Write in the product voice: terse, dry, receipt-flavored. No emoji.
    No hashtags."
  Context types:
  ```ts
  export interface BanterContext {
    viewerHandle: string; opponentHandle: string;
    record: { wins: number; losses: number; draws: number }; // lifetime vs this rival
    currentWeek: { scoreViewer: number; scoreOpponent: number; daysRemaining: number } | null;
    lastVerdictLine: string | null;  // the deterministic narrate() output, verbatim
    memory: string[];                // xTrace memory texts, may be []
  }
  export interface CalloutDraftContext {
    challengerHandle: string; targetHandle: string;
    record: { wins: number; losses: number; draws: number };
    memory: string[];
  }
  export interface RecapContext {
    handle: string; seasonName: string;
    stats: { pairings: number; wins: number; losses: number; draws: number;
             bestStreak: number; calloutsSent: number; calloutsWon: number };
    verdictLines: string[];          // deterministic verdict lines, in order
    memory: string[];
  }
  ```
- `packages/companion/src/generate.ts`:
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  export interface Generator {
    banter(ctx: BanterContext): Promise<string[] | null>;        // 1–COMPANION_BANTER_MAX_LINES lines, filtered
    calloutDrafts(ctx: CalloutDraftContext): Promise<string[] | null>; // up to 3
    seasonRecap(ctx: RecapContext): Promise<SeasonRecapContent | null>; // core's seasonRecapContentSchema type
  }
  export function createGenerator(client: Anthropic): Generator;
  export function generatorFromEnv(env?: NodeJS.ProcessEnv): Generator | null; // null if ANTHROPIC_API_KEY unset
  ```

**Spec:**
- SDK: `@anthropic-ai/sdk` (TypeScript). Model: `COMPANION_MODEL`
  (`claude-opus-4-8`) — read from core config, never inline. Client
  constructed with `timeout: COMPANION_LLM_TIMEOUT_MS` (TS SDK timeouts are
  in **milliseconds**) and `maxRetries: 1`.
- Use structured outputs: `client.messages.parse` with
  `output_config: { format: zodOutputFormat(schema) }` where schema is
  `z.object({ lines: z.array(z.string()).min(1).max(3) })` for
  banter/drafts and core's `seasonRecapContentSchema` shape for recaps.
  Do NOT set `temperature`/`top_p` (rejected on this model). Do not
  configure `thinking` (defaults are correct).
- `max_tokens: COMPANION_MAX_OUTPUT_TOKENS`.
- **Fail-open contract:** every path that isn't a validated, filtered,
  non-empty result returns `null` — typed API errors (catch the SDK's typed
  classes, most-specific first: `RateLimitError`, `APIStatusError`/`APIError`,
  `APIConnectionError`), `stop_reason === 'refusal'`, `parsed_output` null,
  all lines removed by `filterLines`, recap paragraphs failing schema.
  Log one warn line (no prompt contents in logs). Never throw.
- Post-processing: run `filterLines` on every string field; for recaps a
  filtered-out paragraph drops that paragraph, and a result with zero
  surviving paragraphs (or a filtered title) → `null`.
- `memory` arrays are truncated defensively before prompting: max
  `COMPANION_SEARCH_LIMIT` items, each hard-truncated to 500 chars.

**Acceptance criteria (unit tests; inject a fake `Anthropic`-shaped client —
define a minimal `{ messages: { parse: vi.fn() } }` double, don't hit the
network):**
- Happy path per kind: fake parse returns valid `parsed_output` → lines
  returned, filter applied.
- A line containing `$50` or the word "bet" is dropped; all-lines-dropped →
  null.
- Refusal stop_reason → null; thrown `RateLimitError` → null; null
  `parsed_output` → null. No test throws.
- Prompt builders: snapshot test the built prompts for a fixed context
  (guards accidental prompt drift; update snapshots consciously).
- `pnpm verify` green.

**Out of scope:** callers, caching, retrieval (T6–T8).

---

## XH-T4 — DB: `companion_artifacts`, `companion_ingest_log`, repository

**Goal:** Storage for generated artifacts (the cost-bounding cache) and
ingestion idempotency, plus typed repository helpers and test factories.

**Files:**
- `packages/db/src/schema/companion.ts` (new; re-export from
  `schema/index.ts` barrel):
  - PG enum `companion_artifact_kind` mirroring core's
    `COMPANION_ARTIFACT_KIND` (follow the existing 1:1 mirroring pattern in
    `packages/db/src/schema/enums.ts` — add it there if that file is where
    all pgEnums live; match whichever pattern `calloutStatusEnum` uses).
  - `companion_artifacts`: `id uuid PK` (same default pattern as
    `callouts.id`), `kind companion_artifact_kind not null`,
    `cacheKey text not null` + unique index, `profileId uuid not null →profiles`,
    `pairingId uuid null →nemesis_pairings`, `seasonId uuid null →seasons`,
    `content jsonb not null` (shape:
    `{ lines?: string[], recap?: {title, paragraphs}, model: string, promptVersion: number }`),
    `createdAt timestamptz not null default now`.
    Index on `(profileId, kind, createdAt)`.
  - `companion_ingest_log`: `sourceKind text not null` (values:
    `'pairing_verdict' | 'post'`), `sourceId uuid not null`,
    `ingestedAt timestamptz not null default now`; composite PK
    `(sourceKind, sourceId)`.
- Migration: run `pnpm db:generate` (drizzle-kit, timestamp prefix); commit
  the generated SQL + meta snapshot. Never hand-edit `0001_init.sql`.
- `packages/db/src/repositories/companion.ts` (follow the existing
  repository file layout under `packages/db/src` — put it wherever
  `callouts`' queries live; if repositories live in app `lib/` instead,
  put these helpers in `packages/db/src/repositories/companion.ts` and
  export from the package barrel so both `web` and `worker` can use them):
  ```ts
  getArtifactByCacheKey(db, cacheKey): Promise<CompanionArtifactRow | null>
  insertArtifactIdempotent(db, row): Promise<CompanionArtifactRow>
  //  ^ INSERT ... ON CONFLICT (cache_key) DO NOTHING, then SELECT — safe
  //    under concurrent generation of the same key
  latestRecapForProfile(db, profileId): Promise<CompanionArtifactRow | null>
  markIngested(db, entries: {sourceKind, sourceId}[]): Promise<string[]>
  //  ^ INSERT ... ON CONFLICT DO NOTHING RETURNING source_id — returns the
  //    ids that were NEWLY claimed; callers only ingest those (at-least-once
  //    pg-boss safety)
  filterUningested(db, sourceKind, ids: string[]): Promise<string[]>
  ```
- `packages/db/src/testing/factories.ts` — add `buildCompanionArtifact`
  (defaults: kind `'banter'`, content `{lines:['…'], model:'test', promptVersion:1}`).

**Cache-key format (pinned; used by T6–T8):**
- banter: `banter:{pairingId}:{profileId}:{etDay}` where `etDay` is the
  `YYYY-MM-DD` America/New_York calendar day of `now()` — compute it with
  the same mechanism the pairing-reactions flow uses for `reactionDate`
  (grep `reactionDate` under `apps/web/lib/nemesis/`; if the helper isn't
  exported/importable from packages, add `etCalendarDay(d: Date): string`
  to `packages/core/src/clock.ts` in this task and refactor nothing else).
- callout draft: `callout_draft:{challengerProfileId}:{targetProfileId}:{etDay}`
- recap: `recap:{seasonId}:{profileId}` (no day — one per season).

**Acceptance criteria:**
- `pnpm db:check` clean; migration applies on a fresh Postgres
  (integration test in `packages/db/test/integration/` following the
  existing inline-setup pattern: `TEST_DATABASE_URL`, migrate, truncate).
- Integration tests: `insertArtifactIdempotent` called twice concurrently
  with the same key yields one row and both calls return it;
  `markIngested` twice returns the ids once; FK cascade sanity (inserting
  with a bogus profileId rejects).
- `pnpm verify` green.

**Out of scope:** any generation or HTTP.

---

## XH-T5 — Worker: rivalry memory ingestion job

**Goal:** A scheduled job that ships concluded-rivalry material into xTrace,
so retrieval has something to find. Runs entirely off the request path.

**Files:**
- `apps/worker/src/jobs/companion-ingest.ts` — exports
  `companionIngestHandler: JobHandler` and pure-ish core
  `runCompanionIngest(ctx: JobContext, xtrace: XtraceClient, at?: Date): Promise<CompanionIngestReport>`
  (report: counts of pairings/posts ingested and skipped — mirror
  `NemesisConcludeReport` style).
- `apps/worker/src/registry.ts` — add entry:
  `{ name: 'companion:ingest', owner: 'XH-T5', cron: '0 4 * * *', handler: companionIngestHandler }`
  (04:00 ET daily; after the Sunday 22:00 `nemesis:conclude` and Monday
  cycle, and colon-namespaced like every other job).

**Spec:**
- Handler shape (mirror `nemesisConcludeHandler`):
  ```ts
  export const companionIngestHandler: JobHandler = async (ctx) => {
    if (!isFlagEnabled('companion')) return;
    const xtrace = xtraceClientFromEnv();
    if (!xtrace) return;                    // memory unconfigured — silent no-op
    await runCompanionIngest(ctx, xtrace);
  };
  ```
- **Source 1 — concluded pairing verdicts.** Query `nemesis_pairings` where
  `verdict IS NOT NULL`, joined against `filterUningested(db, 'pairing_verdict', ids)`.
  For each pairing, build TWO ingest calls (one per side) so each profile
  owns its own memory of the rivalry:
  - `userId` = that side's profileId, `convId = pairingConvId(pairingId, profileId)`,
    `groupIds = [pairingGroupId(pairingId)]`.
  - `messages`: a single `user` turn summarizing the concluded week from
    that side's perspective, built ONLY from: both handles, final
    `scoreA/scoreB` (oriented to the side), `winnerProfileId` outcome,
    `isRematch`, and the deterministic verdict narration line if present in
    the `verdict` jsonb. Compose it as plain prose (xTrace extracts facts
    server-side; no pre-classification needed).
  - After BOTH sides' `ingest` calls return true, `markIngested` the
    pairing. If either returns false, skip marking (retried next run —
    ingestion is idempotent on the xTrace side only in effect; duplicate
    facts are acceptable, missing facts are not).
- **Source 2 — pairing thread posts.** Query `posts` where
  `contextKind = 'pairing'`, `status = 'visible'`, not yet in
  `companion_ingest_log` (`sourceKind 'post'`), and the parent pairing is
  concluded or active (posts are mutually visible either way — §9.3 is
  about pick sides, which posts never contain structurally... they COULD
  contain user-typed hints; acceptable: both rivals already see the thread,
  so group-sharing adds zero new visibility). One ingest per post:
  `userId` = author profileId, `convId = pairingConvId(...)`,
  `groupIds = [pairingGroupId(...)]`, message = the post body with an
  attribution prefix (`"{handle} said in the rivalry thread: …"`).
  Mark ingested on success.
- Batch cap per run: 200 sources (constant local to the job file), so a
  backlog never makes the job long-running. Log the report via the job's
  standard logging.
- **Never** query or send: picks, open questions, emails, or anything from
  `users`.

**Acceptance criteria:**
- Worker integration test (`apps/worker/test/integration/`, existing
  pattern: real PG, `process.env.FLAG_COMPANION = 'true'`, fake
  `XtraceClient` capturing calls): seed via factories a concluded pairing
  with verdict + 2 posts → run → assert 2 verdict ingests (one per side,
  correct group/conv ids, no forbidden fields in payload text — assert
  no `@`/email-like strings) + 2 post ingests + log rows; run again →
  zero new ingest calls (idempotency).
- Fake client returning false → nothing marked; next run retries.
- Flag off → handler returns without touching the DB (unit test).
- `pnpm verify` green.

**Out of scope:** retrieval, generation, any web surface.

---

## XH-T6 — Banter API route + Rivals hub panel

**Goal:** The demo centerpiece: a claimed participant opens the Rivals hub
and sees 1–3 lines of rivalry banter grounded in shared pairing memory,
generated at most once per profile per ET day.

**Files:**
- `apps/web/app/api/v1/pairings/[pairingId]/banter/route.ts` — `GET`,
  `runtime = 'nodejs'`, wrapped in `runRoute`.
- `apps/web/lib/companion/banter.ts` — the logic (route stays thin like
  the callouts route → `lib/callouts.ts` split).
- `apps/web/lib/rate-limit-rules.ts` — add rule `companion_banter`
  (suggested: 30/day per profile; follow the file's existing rule format).
- `apps/web/components/companion/CompanionBanter.tsx` — `'use client'`
  island.
- `apps/web/lib/copy.ts` — add `companionCopy` block:
  `{ heading, disclaimer, loading }`; disclaimer must convey
  "AI-generated color — the record is the record" (exact wording written in
  the task PR, must pass the money-word test automatically since it lives
  in copy.ts).
- Mount point: inside the claimed-nemesis-tab composition in
  `apps/web/app/rivals/page.tsx` (which is `force-dynamic` and already
  resolves identity server-side): server code checks
  `isFlagEnabled('companion')` and that the viewer has an active pairing,
  then renders `<CompanionBanter pairingId={...} />`. Do NOT touch
  `/vs/[pairingId]` (ISR, viewer-free, INV-10).

**Route spec (`GET /api/v1/pairings/:pairingId/banter`):**
1. Flag off → `ApiError('NOT_FOUND')`.
2. `resolveIdentityFromRequest`; not claimed → `ApiError('UNAUTHENTICATED')`.
3. Load the pairing (reuse the nemesis service lookup used by the reactions
   guard); viewer's profileId must be side A or B, else
   `ApiError('FORBIDDEN')`.
4. `enforceRateLimit('companion_banter', profileId)`.
5. `cacheKey = banter:{pairingId}:{profileId}:{etDay}`;
   `getArtifactByCacheKey` hit → return
   `jsonSuccess({ banter: { lines, generated_at } })`.
6. Miss → build `BanterContext`:
   - RECORD from Postgres only: lifetime W-L-D vs this opponent (fold
     `getNemesisHistoryPage` the way the grudge book does), current week
     scores from the pairing row, `lastVerdictLine` from the most recent
     concluded pairing's `verdict` jsonb (the stored narration line).
   - MEMORY: `xtrace.search({ query: '<opponentHandle> rivalry banter grudges history', groupIds: [pairingGroupId], include: ['fact','episode'] })`
     — fail-open `[]`.
7. `generator.banter(ctx)`; null → `jsonSuccess({ banter: null })` (200,
   UI hides — degraded is not an error).
8. `insertArtifactIdempotent` (kind `banter`, content
   `{ lines, model, promptVersion }`) and return the stored row's lines
   (covers a concurrent double-generate: both callers return the single
   stored artifact).
- Both the xTrace search and the LLM call happen inside this route
  (worst case ~20s bounded by client timeouts) — acceptable because it is
  a lazily-fetched island endpoint, never SSR. The island must show a
  loading state and tolerate the wait.

**Client island spec:** on mount, `fetch('/api/v1/pairings/{id}/banter', { credentials: 'same-origin' })`;
render `companionCopy.loading` skeleton while pending; parse with
`getBanterResponseSchema` (import from `@receipts/core`); `banter: null`,
non-200, or fetch error → render nothing (`return null`). Show heading,
lines, and the disclaimer. No polling, no retries.

**Acceptance criteria:**
- Route unit tests (existing route-test style with mocked lib): flag off →
  404 envelope; ghost → 401; non-participant claimed → 403; cache hit
  returns stored lines without invoking generator (assert generator mock
  not called); generator null → `{banter:null}` with 200; generation
  stores artifact (second call same day hits cache).
- Island tests (`apps/web/test/`, jsdom + stubbed fetch like
  `share-client.test.ts`): renders lines on success; renders nothing on
  `{banter:null}` and on 500.
- Money-word safety: a generator double returning a `$` line must result in
  that line absent from the response (i.e., the route consumes T3's
  filtered output — assert by wiring the real `filterLines` in one test).
- `pnpm verify` green.

**Out of scope:** `/vs` page, notifications, streaming.

---

## XH-T7 — Callout draft API + share-sheet integration

**Goal:** "Draft my callout": generated trash-talk that rides ONLY the
native share/clipboard payload next to the existing challenge link. The
in-app callout contract (stamps-only, no message field) is untouched.

**Files:**
- `apps/web/app/api/v1/callouts/draft/route.ts` — `POST`, `runRoute`,
  `assertSameOrigin`, flag `callout_draft`, claimed-only, rate rule
  `callout_draft` (suggested 10/day per profile) added to
  `rate-limit-rules.ts`.
- `apps/web/lib/companion/callout-draft.ts` — logic.
- `apps/web/components/callouts/CalloutDraftButton.tsx` — `'use client'`;
  rendered by `CalloutPanel` beside each candidate's existing
  `CalloutButton` when the server passes `draftEnabled` (rivals page reads
  `isFlagEnabled('callout_draft')` and passes it into `CalloutPanel` as a
  new prop — server-reads-flag, passes-prop pattern).
- `apps/web/lib/copy.ts` — extend `calloutsCopy` with
  `draftButtonLabel`, `draftPickerHint`, `draftFailed` strings.

**Route spec (`POST /api/v1/callouts/draft`, body
`draftCalloutBodySchema`):**
1–4. Same gate ladder as T6 (flag, claimed, rate limit) plus body parse.
5. Target must be a real profile that appears in the challenger's callout
   candidates or nemesis history (reuse `getCalloutCandidates` /
   `getNemesisHistoryPage`); otherwise `ApiError('FORBIDDEN')` — no
   drafting against strangers.
6. `cacheKey = callout_draft:{profileId}:{targetProfileId}:{etDay}` —
   artifact hit returns stored drafts.
7. RECORD: lifetime W-L-D vs target (same fold as T6). MEMORY:
   `xtrace.search` with `userId: profileId` (the challenger's own memory;
   there may be no shared pairing group with an expired rival —
   own-scope + any past `pairing:` groups both sides shared are already
   readable via user scope... no: group memories are fetched by group.
   Keep it simple and pinned: search twice when a prior pairingId with this
   target exists — once user-scoped, once group-scoped — concatenate, cap
   at COMPANION_SEARCH_LIMIT).
8. Generate via `generator.calloutDrafts`; null →
   `ApiError('UNAVAILABLE', 'draft generation unavailable')` mapped to
   whatever existing 5xx-ish code `ERROR_CODES` has for degraded features
   (grep `ERROR_CODES` in `packages/core/src/errors.ts`; if no fitting code
   exists, this task adds `COMPANION_UNAVAILABLE: 503` there —
   contract-change note in PR). Rationale: unlike the passive banter panel,
   the user explicitly clicked — silent nothing is worse than an honest
   error toast.
9. Store artifact, return `draftCalloutResponseSchema` shape.

**Button spec:** click → POST → on success show the up-to-3 drafts inline
(radio/tap-to-select), selected text is passed into the existing share flow:
call the same share path `CalloutButton` uses but with
`text: `${selectedDraft} ${share_url}`` — i.e., the button first creates
the callout via the existing `POST /api/v1/callouts` (unchanged), then
shares link + draft together via `navigator.share`/clipboard fallback
(`copyShareLink` in `lib/share-client.ts` — add a sibling `copyShareText`
if it only takes URLs). On draft failure: toast `calloutsCopy.draftFailed`,
and the plain share flow still works.

**Acceptance criteria:**
- Route tests: gate ladder (404/401/403/429 paths); stranger target → 403;
  cache hit skips generator; degraded generator → the chosen error code,
  and the plain callout flow is unaffected (separate route).
- Component test: drafts render after click; selecting one and sharing
  passes combined text to the (stubbed) share client; draft failure leaves
  the original `CalloutButton` functional.
- Grep-level assertion in test: `createCalloutBodySchema` and the callouts
  table are untouched by this task (no new columns/fields — the review
  loop enforces via repo-reality lens; state it in the PR description).
- `pnpm verify` green.

**Out of scope:** storing drafts on the callout row, rendering drafts
anywhere in-app after the share, opponent-side surfaces.

---

## XH-T8 — Season wrapped: batch job + `/you` panel

**Goal:** One narrative recap per claimed profile per nemesis season,
generated by a batch job (never in-request), rendered on `/you`.

**Files:**
- `apps/worker/src/jobs/companion-season-recap.ts` — exports
  `companionSeasonRecapHandler: JobHandler` (data:
  `{ seasonId?: string }` — omitted means "most recently ended nemesis
  season") + `runSeasonRecap(ctx, xtrace, generator, seasonId)`.
- `apps/worker/src/registry.ts` — add
  `{ name: 'companion:season-recap', owner: 'XH-T8', handler: companionSeasonRecapHandler }`
  (queue-only, no cron — seasons are 12 weeks; trigger manually or wire a
  cron later).
- `apps/worker/scripts/run-season-recap.mts` — thin script:
  `boss.send('companion:season-recap', { seasonId: process.argv[2] })`
  (mirror how existing worker scripts construct pg-boss), for the demo and
  ops.
- `apps/web/app/you/page.tsx` — add a recap section for claimed viewers:
  server-side `isFlagEnabled('season_wrapped')` &&
  `latestRecapForProfile(db, profileId)` → render title + paragraphs +
  the same `companionCopy.disclaimer`. No client island needed (it's
  pre-generated data; render server-side — `/you` is already dynamic and
  viewer-scoped).
- `apps/web/lib/copy.ts` — `youCopy` gains `recapHeading`.

**Job spec:**
- Gate: flag `season_wrapped`; `generatorFromEnv()`/`xtraceClientFromEnv()`
  null → log + return.
- Resolve season: given id, or latest `seasons` row with `kind='nemesis'`
  and `endsOn < today`.
- Eligible profiles: distinct claimed profiles appearing in that season's
  `nemesis_pairings` (either side) — claimed = profile has a linked user
  (follow however `lib/callouts-view.ts` distinguishes claimed).
- Per profile (sequential loop — no concurrency; a season of hackathon
  scale is tens of profiles; bounded by LLM timeout each):
  1. Skip if `recap:{seasonId}:{profileId}` artifact exists (idempotent
     re-runs).
  2. Build `RecapContext.stats` with plain SQL over `nemesis_pairings`
     (+ callouts counts); `verdictLines` = that profile's pairings'
     stored verdict narration lines, chronological.
  3. MEMORY: `xtrace.search({ userId: profileId, query: 'season rivalry highlights grudges', include: ['episode','fact'] })`.
  4. `generator.seasonRecap(ctx)`; null → skip profile (log), continue.
  5. `insertArtifactIdempotent` kind `season_recap`,
     content `{ recap: {title, paragraphs}, model, promptVersion }`.
- Report counts (generated / skipped-existing / skipped-failed) like other
  job reports.

**Acceptance criteria:**
- Worker integration test: seeded season + 2 concluded pairings + fake
  xtrace/generator → 2 artifacts; re-run → 0 new (idempotent); one
  generator-null profile → skipped, job completes.
- `/you` renders recap when artifact exists + flag on; renders nothing when
  flag off or no artifact (server-component test or e2e-lite following
  existing `/you` test coverage style).
- `pnpm verify` green.

**Out of scope:** share cards / OG images for recaps (stretch, separate
task if time), non-nemesis seasons, cron scheduling.

---

## XH-T9 — Demo seed + runbook

**Goal:** One command that fabricates a demo-ready rivalry world and a
written demo script, so the hackathon demo is reproducible on a fresh dev
stack.

**Files:**
- `apps/web/scripts/demo/seed-companion-demo.mts` — extends the
  screenshot-tour seeding pattern (`apps/web/scripts/screenshot-tour/seed-fixtures.mts`
  is the template): using `@receipts/db/testing` factories + direct
  inserts, create: 2 claimed profiles (distinct handles with personality,
  e.g. `chalk_daddy` / `fade_the_public` — must pass any handle
  constraints), a nemesis season, 3 concluded pairings between them across
  3 weeks (with verdict jsonb containing verdict lines; alternate winners;
  final one `isRematch: true`), 8–10 pairing-thread posts with distinctly
  quotable trash talk, one currently-active pairing for this week, and
  callout candidates state. Print the profile ids/handles and pairing ids.
- `docs/xtrace-hackathon-demo.md` — the runbook: env vars needed (real
  `XTRACE_API_KEY` + `ANTHROPIC_API_KEY`), flag env lines, exact command
  sequence (seed → run `companion:ingest` once via a one-off
  `boss.send` script or direct handler invocation → hit banter route as
  each profile → run recap job → walk the three surfaces), what each demo
  beat shows the judges, and the reset procedure (truncate the three
  companion tables + re-run). Include the "facts are authoritative /
  memory is color" one-liner for the pitch.

**Spec notes:**
- Script must be idempotent (re-run safe): key fixture rows on fixed ids or
  handles and upsert, exactly like `seed-fixtures.mts` does.
- Use `now()`-relative dates so `TEST_CLOCK` can shift the world if needed;
  don't hardcode calendar dates.
- The script does NOT call xTrace/Claude itself — it seeds Postgres only;
  the jobs/routes do the rest (that's the demo).

**Acceptance criteria:**
- On a fresh dev stack (`docker-compose` PG + migrations + seed): running
  the script twice yields no duplicate-key errors and one coherent world.
- Following the runbook top-to-bottom on a machine with real keys produces:
  visible banter on `/rivals` for both profiles, callout drafts, and a
  recap on `/you` — verified once by a human before demo day.
- `pnpm verify` green (script is excluded from builds like other `.mts`
  scripts; confirm it typechecks under the web app's config the way
  screenshot-tour scripts do).

---

## Appendix A — xTrace API (pinned 2026-07-23, from api.staging.xtrace.ai/openapi.public.json)

Base URL: `https://api.production.xtrace.ai`. Auth: `x-api-key: <key>`
header (Bearer also supported). Error shape:
`{ detail: { code, message } }`; 429 carries `Retry-After`.

**POST /v1/memories** (ingest; async — 202 returns
`{ object:'ingest_job', id, status }`; we never pass `?wait=true`):
```json
{
  "messages": [{ "role": "user", "content": "…", "date": null }],
  "user_id": "<profiles.id>",        // required
  "conv_id": "pairing:{id}:{pid}",   // required
  "app_id": "<XTRACE_APP_ID>",
  "group_ids": ["pairing:{id}"],
  "agent_id": null
}
```
Server auto-classifies into facts / artifacts / episodes; no
pre-classification.

**POST /v1/memories/search**:
```json
{
  "query": "…",                       // 1–4000 chars, required
  "mode": "retrieve",                 // we always use retrieve, not compose
  "user_id": "<profiles.id>" | null,
  "group_ids": ["pairing:{id}"],      // OR'd
  "app_id": "<XTRACE_APP_ID>",
  "include": ["fact", "episode"]
}
```
Response: `{ object:'search', data: [{ id, type, text, user_id, group_ids,
score, created_at, … }], … }` — ranked; `score` may be null.

Not used at hackathon scope (explicit cut, revisit before any real launch):
`PATCH /v1/memories/{id}` (group re-tagging, needed for block-revocation),
`DELETE /v1/memories/{id}` (needed for account-deletion cascade),
`GET /v1/memories` (list), groups/usage/webhooks APIs.

## Appendix B — Claude API notes (pinned)

- SDK `@anthropic-ai/sdk` (TypeScript). Model `claude-opus-4-8` via
  `COMPANION_MODEL`.
- No `temperature`/`top_p`/`top_k` (400 on this model). Omit `thinking`
  config. Structured outputs via `client.messages.parse` +
  `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`;
  `parsed_output` is null on parse failure — treat as degraded.
- Handle `stop_reason === 'refusal'` before reading content.
- Typed errors, most-specific first: `RateLimitError`,
  `APIStatusError`, `APIConnectionError`, `APIError`.
- TS client `timeout` option is milliseconds.
