# xTrace hackathon integration — task breakdown

Status: CONVERGED (strict) 2026-07-23 — a full 4-lens panel round
returned zero findings after 80 fixes across six finding rounds plus a
main-session pass. Full round history and the mandatory review process
for any future edit: `docs/xtrace-hackathon-review-log.md`.

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
| XH-T3 | `@receipts/companion`: generation service | XH-T1, XH-T2 |
| XH-T4 | DB: `companion_artifacts` + `companion_ingest_log` + repository | XH-T1 |
| XH-T5 | Worker: rivalry memory ingestion job | XH-T2, XH-T4 |
| XH-T6 | Banter API route + Rivals hub panel | XH-T2, XH-T3, XH-T4 |
| XH-T7 | Callout draft API + share-sheet integration | XH-T2, XH-T3, XH-T4 |
| XH-T8 | Season wrapped: batch job + `/you` panel | XH-T2, XH-T3, XH-T4, XH-T6 |
| XH-T9 | Demo seed script + runbook | XH-T5..T8 |
| XH-T10 | Fix: real xTrace groups (client + DB storage) | XH-T2, XH-T4 |
| XH-T11 | Fix: wire real group ids into ingest + search | XH-T5, XH-T6, XH-T7, XH-T10 |

XH-T10/T11 are POST-CONVERGENCE fixes, added 2026-07-24 after the round-7
"CONVERGED" status above — they were never in the reviewed round and do not
carry that status. See their own Goal sections for the bug they fix
(group-scoped memory search has been silently returning nothing since T5
shipped) and Appendix A's corrected groups section for the root cause.

Demo-critical path: T1 → T2 → T3 (T4 in parallel after T1) → T6. T5 is
NOT a code dependency of T6 (the banter route's memory search is fail-open
and works with zero ingested memories) — but the demo needs T5 to have run
at least once beforehand so banter shows grounded memory, hence T5 sits on
the demo path though not in T6's dependency row.
T7 is independently shippable once T2, T3, and T4 have merged; T8
additionally needs T6 (it reuses `companionCopy.disclaimer`). T9 requires
all of T5–T8 — the runbook walks all three surfaces.

---

## XH-T1 — Contracts, flags, config (contract-change PR)

**Goal:** All shared names, types, schemas, flags, and constants the other
tasks consume, defined once in `packages/core`.

**Files:**
- `packages/core/src/flags.ts` — add to `FLAG_DEFAULTS` (all `false`):
  `companion`, `callout_draft`, `season_wrapped`.
- `.env.example` — under the existing `# --- Feature flags (§4.6) ---`
  section (that header carries a trailing note; match it by prefix) add
  `FLAG_COMPANION`,
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
  - `COMPANION_DRAFT_MAX = 3` (callout drafts per generation — distinct
    from the banter constant so tuning one never silently breaks the
    other's response schema)
  - `COMPANION_SEARCH_LIMIT = 8` (memories per retrieval)
  - `RL_COMPANION_BANTER_PROFILE_D = 30` (T6's rate rule; per profile per day)
  - `RL_CALLOUT_DRAFT_PROFILE_D = 10` (T7's rate rule; per profile per day)
  - `MONEY_WORD_REGEX_SOURCE = '\\bbet(s|ting|ted)?\\b|\\bstak(e|es|ed|ing)\\b|\\bwager(s|ing|ed)?\\b|\\$'`
    — a strict SUPERSET of the `apps/web/test/copy.test.ts` literal
    (`\bbet\b|\bstake\b|\bwager\b|\$`): the copy test lints small
    human-written pinned strings where bare tokens suffice, but this
    constant filters LLM output, which freely produces morphological
    variants ("no more betting against you", "still wagering on a
    rematch") that `\b`-anchored bare tokens never match. The test keeps
    its own literal (both pinned; the runtime filter being stricter is
    fine, the reverse would not be).
- `packages/core/src/errors.ts` — add `COMPANION_UNAVAILABLE: 503` to
  `ERROR_CODES` (used by T7's degraded path; the table has no generic
  degraded-feature code — its only 503, `PRICE_UNAVAILABLE`, is
  venue-pricing-specific and must not be reused). Also update
  `packages/core/test/contracts.test.ts`: the "has all 22 codes" test pins
  `expect(Object.keys(ERROR_CODES)).toHaveLength(22)` — bump it to 23, add
  `expect(ERROR_CODES.COMPANION_UNAVAILABLE).toBe(503)`, and note the
  addition in the test name/comment the way earlier additions are noted.
  Editing that pin is expected, not a mistake.
- `packages/core/src/enums.ts` — add registry-style
  `COMPANION_ARTIFACT_KIND = ['banter', 'callout_draft', 'season_recap'] as const`
  and `CompanionArtifactKind` type, mirroring existing enum entries.
- `packages/core/src/schemas/companion.ts` (new; re-export from
  `schemas/index.ts`) — zod schemas (define ONLY what a task consumes — no
  extra id brands or line-object schemas; every export below has a named
  consumer in T3/T6/T7/T8):
  ```ts
  export const getBanterResponseSchema = z.object({
    banter: z.object({
      lines: z.array(z.string().min(1).max(280)).min(1).max(COMPANION_BANTER_MAX_LINES),
      generated_at: zTimestamp,
    }).nullable(),           // null = feature degraded/hidden, always 200
  });                        // ^ import COMPANION_BANTER_MAX_LINES from config — T3's
                             //   zodOutputFormat schema uses the same constant, no literal 3s
  export const draftCalloutBodySchema = z.object({
    target_profile_id: zProfileId,
  }).strict();
  export const draftCalloutResponseSchema = z.object({
    drafts: z.array(z.string().min(1).max(280)).min(1).max(COMPANION_DRAFT_MAX),
  });
  export const seasonRecapContentSchema = z.object({
    title: z.string().min(1).max(120),
    paragraphs: z.array(z.string().min(1).max(600)).min(1).max(4),
  });
  export type SeasonRecapContent = z.infer<typeof seasonRecapContentSchema>;
  //  ^ exported from the core root — T3's `seasonRecap` return type imports it.
  //  NOTE deliberately absent: no `getRecapResponseSchema` — T8's /you panel is
  //  server-rendered straight from the DB row (no GET recap route exists in any
  //  task), so a response schema would violate this file's every-export-has-a-
  //  named-consumer rule. Add one only if a recap API route is ever added.
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
  `test`) copied from `packages/venues/package.json` — there is no
  per-package `lint` script anywhere in `packages/`; the root `pnpm lint`
  (`eslint . --max-warnings 0`) covers the new package automatically —
  venues being the
  structural template for this whole package (copy BOTH tsconfigs from
  venues — `tsconfig.json` extends `@receipts/config/tsconfig.base.json`
  with `noEmit`, and `tsconfig.build.json` extends
  `@receipts/config/tsconfig.package.json`; the copied
  `build: tsc -p tsconfig.build.json` script fails without the second.
  No per-package eslint config file — venues has none; the root
  `eslint.config.mjs` covers it. `vitest.config.ts` with
  `test/**/*.test.ts`).
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
  //  ^ returns null when XTRACE_API_KEY or XTRACE_APP_ID unset — callers treat null as "memory unavailable".
  //    apiBase falls back to XTRACE_DEFAULT_API_BASE = 'https://api.production.xtrace.ai'
  //    (export the constant from client.ts) when XTRACE_API_BASE is unset — no
  //    other task defines a code-level default, so it lives here.
  ```
- `packages/companion/src/redact.ts` — `scrubPii(text: string): string`:
  replaces email-like substrings (`\S+@\S+\.\S+`-grade pattern) and
  phone-like substrings (7+ digit runs allowing separators
  `[-.() ]`) with `[redacted]`. Consumed by XH-T5 on every post body
  before ingest — ground rule 6 forbids emails leaving the app, post
  bodies are free-form user text, and the repo's moderation model (§14) is
  reactive removal, not a pre-send filter, so the scrub is the only thing
  standing between a user typing their email into a trash-talk thread and
  that email landing in a third-party store. Keep it deliberately crude
  (over-redaction of rivalry banter is harmless; under-redaction is not).
  Unit tests: an email, a `(555) 123-4567`-style phone, and a digits-only
  phone are each replaced; ordinary text with short numbers ("won 3-1
  again", "up 12 points") passes through unchanged.
- `packages/companion/src/index.ts` — barrel export.

**Spec:**
- **Fail-open contract:** `ingest` and `search` NEVER throw. Any error
  (non-2xx, timeout, network, zod parse failure) → log via `logger` →
  return `false` / `[]`. Retries: on 429, 5xx, AND network
  errors/timeouts, up to `maxRetries` — the venues template's catch
  block retries fetch rejections too (`packages/venues/src/http-client.ts`
  catch → backoff → continue), and T5's outage arithmetic (~10s per
  failed call ≈ 3s timeout × 3 attempts) assumes exactly this. Other 4xx
  and body-parse failures are NOT retried (retrying can't fix them).
  Full-jitter backoff (copy the `jitteredBackoff` approach from
  `packages/venues/src/http-client.ts`; do not import it — venues is
  venue-scoped — reimplement the ~10-line helper locally).
- Auth header: `x-api-key: <apiKey>`. Always send `app_id: appId` on ingest
  and `app_id` filter on search.
- Timeout via `AbortController`, like the venues client.
- Log messages must never include the API key or full request bodies (post
  bodies are user content); log method, path, status, and error class only.
- **Naming conventions (defined here as exported constants;
  `pairingGroupId` is consumed by T5/T6/T7, `pairingConvId` by T5):**
  ```ts
  export const pairingGroupId = (pairingId: string) => `pairing:${pairingId}`;
  export const pairingConvId = (pairingId: string, profileId: string) => `pairing:${pairingId}:${profileId}`;
  export const seasonConvId = (seasonId: string, profileId: string) => `season:${seasonId}:${profileId}`;
  //  ^ reserved for a future season-episode ingest; no XH task calls it —
  //    do not invent a season-scoped ingest to justify it.
  ```

**Acceptance criteria (unit tests, injected `fetchImpl` fake — no msw; repo
precedent is fetch injection):**
- ingest sends the documented body shape (assert on captured request:
  `messages`, `user_id`, `conv_id`, `app_id`, `group_ids`) and returns true
  on 202.
- search parses a canned response into `XtraceMemory[]`, caps at `limit`,
  and passes `mode: 'retrieve'`.
- 500 → retried `maxRetries` times then `[]`/`false`; 400 → not retried;
  timeout (fetchImpl that never resolves + abort) → retried `maxRetries`
  times then `[]`/`false` (assert the attempt count — timeouts ARE
  retried, per the spec above); malformed JSON → `[]`/`false`, not
  retried. No test throws.
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
    calloutDrafts(ctx: CalloutDraftContext): Promise<string[] | null>; // up to COMPANION_DRAFT_MAX
    seasonRecap(ctx: RecapContext): Promise<SeasonRecapContent | null>; // type imported from @receipts/core (T1 exports it)
  }
  export function createGenerator(client: Anthropic): Generator;
  export function generatorFromEnv(env?: NodeJS.ProcessEnv): Generator | null; // null if ANTHROPIC_API_KEY unset
  ```
- `packages/companion/src/index.ts` — extend T2's barrel with the
  filter/prompts/generate exports (T2 owns the file's creation; this task
  appends to it — hence the T2 dependency).

**Spec:**
- SDK: `@anthropic-ai/sdk` (TypeScript). Model: `COMPANION_MODEL`
  (`claude-opus-4-8`) — read from core config, never inline. Client
  constructed with `timeout: COMPANION_LLM_TIMEOUT_MS` (TS SDK timeouts are
  in **milliseconds**) and `maxRetries: 0` — the SDK timeout is per
  *attempt* and retried attempts would double worst-case caller latency;
  every caller here is fail-open anyway.
- Use structured outputs: `client.messages.parse` with
  `output_config: { format: zodOutputFormat(schema) }` where schema is
  `z.object({ lines: z.array(z.string().min(1).max(280)).min(1).max(COMPANION_BANTER_MAX_LINES) })`
  for banter, the same shape with `.max(COMPANION_DRAFT_MAX)` for callout
  drafts (both constants from core config, matching T1's response schemas —
  no literal 3s; the two caps are separate constants on purpose, so tuning
  banter length can never make the generator emit more drafts than
  `draftCalloutResponseSchema` accepts), and core's
  `seasonRecapContentSchema` shape for recaps. The per-string
  `.min(1).max(280)` bounds are REQUIRED and must equal T1's response
  schemas' inner bounds: the artifact is stored raw and later parsed by
  T6's island / T7's button against those response schemas, so a
  generation-time string the response schema rejects would silently blank
  the surface. (The TS SDK strips unsupported string-length constraints
  from the wire schema and validates them client-side — a violation makes
  `parsed_output` null, which the fail-open contract already maps to a
  degraded `null`, never a stored-invalid artifact.)
  Do NOT set `temperature`/`top_p` (rejected on this model). Do not
  configure `thinking` (defaults are correct).
- `max_tokens: COMPANION_MAX_OUTPUT_TOKENS`.
- **Fail-open contract:** every path that isn't a validated, filtered,
  non-empty result returns `null` — typed API errors (instanceof checks,
  most-specific first for the TS SDK: `RateLimitError`, then
  `APIConnectionError` — it subclasses `APIError` in the TS SDK, so it must
  be checked before the base — then `APIError`; there is no `APIStatusError`
  in the TypeScript SDK; keep a final catch-all so the fail-open contract
  holds), `stop_reason === 'refusal'`, `parsed_output` null,
  all lines removed by `filterLines`, recap paragraphs failing schema.
  Log one warn line (no prompt contents in logs). Never throw.
- Post-processing: run `filterLines` on every string field; for recaps a
  filtered-out paragraph drops that paragraph, and a result with zero
  surviving paragraphs (or a filtered title) → `null`. `filterLines` is
  array-in/array-out — for the scalar recap `title`, call
  `filterLines([title])`: an empty result means the title was filtered,
  and per the rule above the whole recap becomes `null`.
- `memory` arrays are truncated defensively before prompting: max
  `COMPANION_SEARCH_LIMIT` items, each hard-truncated to 500 chars.

**Acceptance criteria (unit tests; inject a fake `Anthropic`-shaped client —
define a minimal `{ messages: { parse: vi.fn() } }` double, don't hit the
network):**
- Happy path per kind: fake parse returns valid `parsed_output` → lines
  returned, filter applied.
- A line containing `$50` or the word "bet" is dropped; morphological
  variants are dropped too — add cases for "betting", "bets", "wagering",
  and "staked" specifically (the regex's variant coverage is the point of
  its divergence from the copy-test literal); all-lines-dropped → null.
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
    `{ lines?: string[], drafts?: string[], recap?: {title, paragraphs}, model: string, promptVersion: number }`
    — one optional slot per artifact kind: `lines` for banter, `drafts`
    for callout drafts, `recap` for recaps; T7 has no `packages/db`
    ownership, so its storage key is pinned HERE),
    `createdAt timestamptz not null default now`.
    Index on `(profileId, kind, createdAt)`.
  - `companion_ingest_log`: `sourceKind text not null` (values:
    `'pairing_verdict' | 'post'`), `sourceId uuid not null`,
    `ingestedAt timestamptz not null default now`; composite PK
    `(sourceKind, sourceId)`.
- Migration: run `pnpm db:generate` (drizzle-kit, timestamp prefix); commit
  the generated SQL + meta snapshot. Never hand-edit `0001_init.sql`.
- `packages/db/src/repositories/companion.ts` — the established location:
  `packages/db/src/repositories/` holds one file per domain (`callouts.ts`,
  `pairings.ts`, `nemesis.ts`, …); follow that layout and export from the
  package barrel so both `web` and `worker` can import these helpers:
  ```ts
  getArtifactByCacheKey(db, cacheKey): Promise<CompanionArtifactRow | null>
  insertArtifactIdempotent(db, row): Promise<CompanionArtifactRow>
  //  ^ INSERT ... ON CONFLICT (cache_key) DO NOTHING, then SELECT — safe
  //    under concurrent generation of the same key
  latestRecapForProfile(db, profileId): Promise<CompanionArtifactRow | null>
  //  ^ the kind = 'season_recap' row for the profile whose SEASON ended most
  //    recently: join seasons on companion_artifacts.season_id and order by
  //    seasons.ends_on DESC (tie-break createdAt DESC), or null. Do NOT order
  //    by createdAt alone — recap keys are per-season and the T9 runbook's
  //    given-seasonId path can (re)generate an OLDER season's recap after a
  //    newer one exists; insertion order would then show the wrong season on
  //    /you, silently (fail-open masks it). The kind filter is load-bearing
  //    (a fresher banter artifact must not shadow the recap); the
  //    (profileId, kind, createdAt) index still serves the filter half.
  markIngested(db, entries: {sourceKind, sourceId}[]): Promise<string[]>
  //  ^ INSERT ... ON CONFLICT DO NOTHING RETURNING source_id — records
  //    sources whose xTrace ingest SUCCEEDED. Callers (XH-T5) select
  //    candidates with filterUningested, ingest to xTrace, and call this
  //    only after every ingest call for the source returned true; the
  //    RETURNING list lets a concurrent duplicate run detect ids another
  //    run already recorded. Never call this BEFORE ingesting — a
  //    marked-but-never-ingested source is silently lost forever
  //    (duplicate facts are acceptable, missing facts are not).
  filterUningested(db, sourceKind, ids: string[]): Promise<string[]>
  lifetimeRecordBetween(db, profileId, opponentProfileId): Promise<{ wins; losses; draws }>
  //  ^ direct SQL aggregate over `completed` nemesis_pairings between the
  //    two profiles, bucketed by winner_profile_id (null = draw), oriented
  //    to the first argument. One owner so T6 and T7 cannot drift on
  //    win/draw bucketing.
  completedPairingIdsBetween(db, profileId, opponentProfileId): Promise<string[]>
  //  ^ ids of those same completed pairings — T6/T7 map these through
  //    pairingGroupId for memory search scoping.
  ```
- `packages/db/src/testing/factories.ts` — add `buildCompanionArtifact`
  (defaults: kind `'banter'`, content `{lines:['…'], model:'test', promptVersion:1}`).

**Cache-key format (pinned; used by T6–T8):**
- banter: `banter:{pairingId}:{profileId}:{etDay}` where `etDay` is the
  `YYYY-MM-DD` America/New_York calendar day of `now()`: `etDay =
  etDateString(now())` — `etDateString` from `@receipts/core`
  (`packages/core/src/et-date.ts`, exported from the core root; the same
  helper the pairing-reactions flow uses for `reactionDate`). Do not add a
  new helper.
- callout draft: `callout_draft:{challengerProfileId}:{targetProfileId}:{etDay}`
- recap: `recap:{seasonId}:{profileId}` (no day — one per season).
- The repository module exports the key **builders** —
  `banterCacheKey(pairingId, profileId, etDay)`,
  `calloutDraftCacheKey(challengerProfileId, targetProfileId, etDay)`,
  `recapCacheKey(seasonId, profileId)` — and T6/T7/T8 MUST call them
  instead of string-formatting keys inline: a separator/ordering typo in
  any one consumer would silently break cache hits (the fail-open design
  turns that into invisible per-request regeneration, not an error).

**Acceptance criteria:**
- `pnpm --filter @receipts/db db:check` clean (there is no root `db:check`
  alias — the root package.json only aliases `db:generate`/`db:migrate`/
  `db:seed`); migration applies on a fresh Postgres
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
  `NemesisConcludeReport` style). `at` defaults to `now()` and is the run's
  evaluation instant: it is passed as each ingest turn's `date` (ISO string)
  and drives the wall-clock deadline below; it does not filter which
  sources qualify.
- `apps/worker/src/registry.ts` — add entry:
  `{ name: 'companion:ingest', owner: 'XH-T5', cron: '0 4 * * *', handler: companionIngestHandler }`
  (04:00 ET daily; after the Sunday 22:00 `nemesis:conclude` and Monday
  cycle, and colon-namespaced like every other job).
- `apps/worker/scripts/run-companion-ingest.mjs` — thin on-demand trigger:
  `boss.send('companion:ingest', {})`, mirroring the existing
  `apps/worker/scripts/question-zero-drill/manual-schedule.mjs` (worker
  scripts are plain `.mjs`, PgBoss constructed from `DATABASE_URL`; T8's
  later `run-season-recap.mjs` follows the same template — T5 lands
  before T8, so that file does not exist yet). The cron alone is useless
  during a live demo; T9's runbook invokes this script by path.
- `apps/worker/test/registry.test.ts` — add `companion:ingest` to
  `SPEC_JOBS` (the test asserts the registry matches that list exactly)
  and widen the owner assertion from `/^WS\d+-T\d+$/` to
  `/^(WS\d+|XH)-T\d+$/` (it currently rejects `XH-T5`; note the XH
  alternative has NO digits before `-T` — the registry owners are exactly
  `XH-T5` / `XH-T8`, so a pattern like `/^(WS|XH)\d+-T\d+$/` would still
  reject them). Note both changes in the test's header comment the way
  `bot:score`/`settle:digest` are noted.

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
    `isRematch`, and that side's OWN narration line
    (`verdict.narration[sideProfileId]?.line`) if present. Compose it as
    plain prose (xTrace extracts facts server-side; no pre-classification
    needed).
  - **Verdict jsonb shape (written by `nemesis:conclude`; consumed here and
    by T6/T8):**
    `{ scoreA, scoreB, edgeA, edgeB, winner, excludedQuestionIds, narration: { [profileId]: { line, emphasis } } }`
    (`ratings:weekly` later spread-merges a `rating_before` key). There is
    no single narration line — `narration` holds TWO per-side lines keyed
    by profile id, each written from that side's perspective ("you beat…"
    vs "…beat you"). T5 ingests each side's own line; T6's
    `lastVerdictLine` is the VIEWER's line; T8's `verdictLines` are that
    profile's own lines. Picking the wrong side's line narrates the
    opponent's perspective to the viewer.
  - After BOTH sides' `ingest` calls return true, `markIngested` the
    pairing. If either returns false, skip marking (retried next run —
    ingestion is idempotent on the xTrace side only in effect; duplicate
    facts are acceptable, missing facts are not).
- **Source 2 — pairing thread posts.** Query `posts` where
  `contextKind = 'pairing'`, `status = 'visible'`, not yet in
  `companion_ingest_log` (`sourceKind 'post'`), and the parent pairing's
  `status` is `'active'` or `'completed'` (`PAIRING_STATUS` has no
  "concluded"; posts on `scheduled`/`cancelled` pairings are skipped —
  posts are mutually visible either way — §9.3 is
  about pick sides, which posts never contain structurally... they COULD
  contain user-typed hints; acceptable: both rivals already see the thread,
  so group-sharing adds zero new visibility). One ingest per post:
  `userId` = author profileId, `convId = pairingConvId(...)`,
  `groupIds = [pairingGroupId(...)]`, message =
  `scrubPii(postBody)` (T2's redactor — MANDATORY: post bodies are the
  only free-form user text this feature ships off-app, and ground rule 6
  forbids emails/PII leaving; the verdict summaries are template-built
  from handles/scores and need no scrub) with an attribution prefix
  (`"{handle} said in the rivalry thread: …"`).
  Mark ingested on success.
- Batch cap per run: `MAX_SOURCES_PER_RUN = 200` (constant local to the
  job file) — a SINGLE SHARED budget across both source types, not a
  per-query limit: select uningested pairing-verdict candidates first (up
  to the budget), then fill any remaining budget with uningested post
  candidates, so the combined total never exceeds 200 per run (a per-query
  reading would double the run's work bound). This keeps a
  backlog from making the job long-running. The cap alone doesn't bound
  wall time — with xTrace down, each call burns ~10s of retried timeouts
  and 200 sources × 2 calls is an hour of sequential failures, blowing
  past pg-boss's job expiration into concurrent re-delivery. So also
  **circuit-break on outage**: abort the run after 5 consecutive `ingest()`
  failures (constant local to the job) or once the run exceeds a 5-minute
  wall-clock deadline from `at` (via `now()`); record the abort in the
  report (`aborted: true`). Unprocessed sources retry next run naturally
  since nothing was marked. Log the report via the job's standard logging.
- **Never** query or send: picks, open questions, emails, or anything from
  `users`.

**Acceptance criteria:**
- Worker integration test (`apps/worker/test/integration/`, existing
  pattern: real PG, `process.env.FLAG_COMPANION = 'true'`, fake
  `XtraceClient` capturing calls): seed via factories a concluded pairing
  with verdict + 2 posts → run → assert 2 verdict ingests (one per side,
  correct group/conv ids) + 2 post ingests + log rows; run again →
  zero new ingest calls (idempotency).
- PII scrub: seed a post whose body contains a literal email address and a
  phone number → the captured ingest payload contains NEITHER verbatim
  (both `[redacted]`) while the rest of the post text survives. (A
  synthetic-posts-only test cannot prove the scrub exists — this seeded
  case is the one that can.)
- Fake client returning false → nothing marked; next run retries.
- Shared budget: seed 150 uningested verdict sources + 150 uningested post
  sources, run once → total sources attempted ≤ 200, verdicts selected
  before posts (pins the single-shared-budget reading).
- Circuit breaker (the load-bearing safety mechanism — it must be tested,
  not just specified): with an always-failing fake client and >5 pending
  sources, the run stops after exactly 5 consecutive `ingest()` CALLS
  (calls, not sources — the count spans the two per-side calls within one
  pairing) and the report has `aborted: true`; an intervening success
  resets the consecutive counter (seed a fake that fails 4×, succeeds,
  then fails 4× → no abort). Deadline: drive `at` + `setTestClock`/
  `advanceTestClock` (§17.2) past the 5-minute deadline mid-run and assert
  the run aborts with `aborted: true` even though fewer than 5 consecutive
  failures occurred — the deadline check must run between individual
  ingest calls, not only between pairings.
- Flag off → handler returns without touching the DB (unit test).
- `pnpm verify` green.

**Out of scope:** retrieval, generation, any web surface.

---

## XH-T6 — Banter API route + Rivals hub panel

**Goal:** The demo centerpiece: a claimed participant opens the Rivals hub
and sees 1–3 lines of rivalry banter grounded in shared pairing memory,
generated at most once per profile per ET day.

**Files:**
- `apps/web/app/api/v1/pairings/[id]/banter/route.ts` — `GET`,
  `runtime = 'nodejs'`, wrapped in `runRoute`. The segment is `[id]`
  because the existing `pairings/[id]/route.ts` already owns that slug
  name and Next.js forbids two slug names at the same dynamic level;
  read the pairing id as `params.id` (the route is still
  `GET /api/v1/pairings/:pairingId/banter` conceptually).
- `apps/web/lib/companion/banter.ts` — the logic (route stays thin like
  the callouts route → `lib/callouts.ts` split).
- `apps/web/lib/rate-limit-rules.ts` — add rule `companion_banter` as
  `{ keyType: 'profile', limit: RL_COMPANION_BANTER_PROFILE_D, windowSeconds: DAY }`,
  importing the constant from `@receipts/core` (T1 defines it — the
  file's header forbids hardcoding limits).
- `apps/web/components/companion/CompanionBanter.tsx` — `'use client'`
  island.
- `apps/web/lib/copy.ts` — add `companionCopy` block:
  `{ heading, disclaimer, loading }`; disclaimer must convey
  "AI-generated color — the record is the record" (exact wording written in
  the task PR; add a `companionCopy` money-word case to
  `apps/web/test/copy.test.ts` following the per-block pattern every other
  copy block uses — the file has no automatic whole-file scan, so a new
  block gets zero coverage unless this task adds it).
- Mount point: inside the claimed-nemesis-tab composition in
  `apps/web/app/rivals/page.tsx` (which is `force-dynamic` and already
  resolves identity server-side): server code checks
  `isFlagEnabled('companion')` and that the viewer has an active pairing,
  then renders `<CompanionBanter pairingId={...} />`. Do NOT touch
  `/vs/[pairingId]` (ISR, viewer-free, INV-10).

**Route spec (`GET /api/v1/pairings/:pairingId/banter`):**
0. `const limited = await enforceGetBackstop(request); if (limited) return limited;`
   — repo rule: every `/api/v1` GET route calls the IP backstop first
   (`apps/web/lib/rate-limit.ts` pins "Called at the top of every
   `/api/v1` GET route handler"; see the sibling
   `pairings/[id]/route.ts`). GET-only — T7's POST route does not call it.
1. Flag off → `ApiError('NOT_FOUND')`.
2. `resolveIdentityFromRequest`; not claimed → `ApiError('UNAUTHENTICATED')`.
3. Load the pairing (reuse the nemesis service lookup used by the reactions
   guard); viewer's profileId must be side A or B, else
   `ApiError('FORBIDDEN')`.
4. `cacheKey = banterCacheKey(pairingId, profileId, etDay)` (T4's builder);
   `getArtifactByCacheKey` hit → return
   `jsonSuccess({ banter: { lines, generated_at } })` WITHOUT consuming
   the `companion_banter` rate budget. The cache check comes BEFORE the
   rate limit on purpose: generation is already bounded to once per
   profile per ET day by the cache key, so the daily budget guards only
   the generation (miss) path — charging cache hits would 429 a viewer
   who opens `/rivals` more than `RL_COMPANION_BANTER_PROFILE_D` times in
   one ET day, and the island's non-200 → render-nothing rule would then
   silently hide the demo centerpiece for the rest of the day.
   `generated_at` = the artifact row's `createdAt` serialized with
   `.toISOString()` (satisfies `zTimestamp`); on both cache hit and fresh
   insert it reflects the stored row, never `now()`. Same rule for T8's
   recap `generated_at`.
5. Miss →
   `const limited = await enforceRateLimit('companion_banter', profileId); if (limited) return limited;`
   — `enforceRateLimit` RETURNS a ready-to-return 429 `NextResponse` or
   null to continue, it does not throw (`apps/web/lib/rate-limit.ts`); a
   fire-and-forget call would consume the token yet never enforce the
   limit, silently.
6. Build `BanterContext`:
   - RECORD from Postgres only:
     - Lifetime W-L-D vs this opponent via T4's `lifetimeRecordBetween`
       (a direct SQL aggregate: count `completed` `nemesis_pairings` rows
       between the two profiles, bucketed into win/loss/draw by
       `winner_profile_id`; T7 consumes the same helper — do not
       reimplement it). (Do NOT fold `getNemesisHistoryPage` the way the
       grudge book does — that fold reads one page capped at
       `NEMESIS_HISTORY_DEFAULT_LIMIT` (20, `apps/web/lib/nemesis/service.ts`),
       silently truncating "lifetime" for long histories.)
     - Current week scores DERIVED from picks, never read from the
       pairing row: `scoreA`/`scoreB` are written only at conclusion by
       `updatePairingConclusion`, so the active pairing's row always
       reads 0–0 mid-week — echoing that as authoritative RECORD would
       state a wrong live score next to the real scoreboard. Compute
       them the way `nemesis:conclude` does:
       `getFullPairingSharedQuestionPicks(...)` folded through
       `@receipts/engine`'s `scoreNemesisWeek` (engine is pure and
       `apps/web` already depends on it; INV-5 forbids only the reverse
       direction).
     - `currentWeek` is non-null ONLY when `pairing.status === 'active'`.
       For a `completed`/`cancelled`/`scheduled` pairing the route still
       serves banter (subject to the same guards) with
       `currentWeek: null` — do not 404 on status.
       `daysRemaining` = ET calendar days from `etDateString(now())` up to
       and including the pairing's week end
       (`addDaysToDateString(weekStart, 6)` — both helpers from
       `@receipts/core`), clamped to ≥ 0.
     - `lastVerdictLine = verdict.narration[viewerProfileId]?.line` from
       the most recent `completed` pairing vs this opponent (see the
       verdict-shape note in XH-T5 — it is a per-profile map, and the
       viewer's own line is the one that reads correctly).
   - MEMORY: gather ALL pairing ids between the two profiles — T4's
     `completedPairingIdsBetween` (the same pairings the RECORD aggregate
     counts) plus the current pairingId — then search ONCE:
     `xtrace.search({ query: '<opponentHandle> rivalry banter grudges history', groupIds: allPairingIds.map(pairingGroupId), include: ['fact','episode'] })`
     — fail-open `[]`. (Appendix A: `group_ids` are OR'd — one call covers
     every rivalry week, mirroring T7 step 7b. Groups are per-pairing and a
     rematch is a NEW pairing id, so searching only the current pairing's
     group would structurally miss every concluded week's verdict memories
     T5 ingests — silently, since retrieval is fail-open.)
7. `generator.banter(ctx)`; null → `jsonSuccess({ banter: null })` (200,
   UI hides — degraded is not an error).
- Instantiate via `xtraceClientFromEnv()` / `generatorFromEnv()` (a
  module-level lazy singleton in `lib/companion/banter.ts` is fine). Null
  xTrace client → MEMORY `[]`; null generator → same as a null generation
  result: `jsonSuccess({ banter: null })`. Unset keys are the default dev
  state — this path must be exercised, not accidental.
8. `insertArtifactIdempotent` (kind `banter`, content
   `{ lines, model, promptVersion }`) and return the stored row's lines
   (covers a concurrent double-generate: both callers return the single
   stored artifact).
- Both the xTrace search and the LLM call happen inside this route
  (worst case ~30s: one LLM attempt at `COMPANION_LLM_TIMEOUT_MS` — T3
  pins `maxRetries: 0` — plus the xTrace search's retried timeouts)
  — acceptable because it is
  a lazily-fetched island endpoint, never SSR. The island must show a
  loading state and tolerate the wait.

**Client island spec:** on mount, `fetch('/api/v1/pairings/{id}/banter', { credentials: 'same-origin' })`;
render `companionCopy.loading` skeleton while pending. The body is the
standard §9.1 success envelope `{ data: ... }` — unwrap before parsing:
`getBanterResponseSchema.parse((await res.json()).data)` (schema from
`@receipts/core`), or reuse the shared `request()` helper from
`lib/pick-client.ts`, which is exported for exactly this and unwraps
`envelope.data` before `schema.parse` (precedent: `CalloutButton.tsx`
reads `body.data?.share_url`). Parsing the raw body with the schema
always fails and — because failure renders nothing — would be a silently
dead panel. CRITICAL if using `request()`: it THROWS `ApiClientError` on
non-2xx, JSON-parse failure, schema-validation failure, and network error
— it does not return a sentinel — so the extracted function MUST wrap the
call in try/catch and map any throw to the same render-nothing value as a
successful `{ banter: null }` response; bare `request()` cannot satisfy
the render-nothing behavior on its own. `banter: null`, non-200, parse
failure, or fetch error →
render nothing (`return null`). Show heading, lines, and the disclaimer.
No polling, no retries.

**Acceptance criteria:**
- Route unit tests (existing route-test style with mocked lib): flag off →
  404 envelope; ghost → 401; non-participant claimed → 403; cache hit
  returns stored lines without invoking generator (assert generator mock
  not called) AND without consuming the rate limit (with the
  `companion_banter` limit exhausted, a same-day repeat request still
  returns the cached artifact — pins the cache-before-limit order);
  generator null → `{banter:null}` with 200; generation
  stores artifact (second call same day hits cache).
- Island tests (`apps/web/test/`, node env — this repo has NO jsdom or
  @testing-library dependency and the web vitest config pins
  `environment: 'node'`; mount-effect behavior is e2e-only per the
  `nemesis-components.test.tsx` convention): extract the island's
  fetch → envelope-unwrap → parse step into a plain exported function
  (internally a try/catch around `request()` from `lib/pick-client.ts`,
  per the island spec — the tests target this WRAPPER, not bare
  `request()`, since only the wrapper returns the render-nothing value on
  throw) and unit-test THAT with
  a stubbed `global.fetch` (the `vi.stubGlobal` style of
  `share-client.test.ts`) — the fetch stub MUST return the enveloped shape
  `{ data: { banter: { lines, generated_at } } }` so the unwrap is
  exercised (a stub of the bare `{ banter }` shape would pass against the
  exact bug it exists to catch); assert `{ data: { banter: null } }`, 500,
  and parse failure all yield the render-nothing value. Cover the
  presentational states (loading / lines + disclaimer / hidden) with
  `renderToStaticMarkup`, the way `nemesis-components.test.tsx` does. Do
  NOT add jsdom/@testing-library — that's a repo-convention change, out of
  scope here.
- Memory scoping: one test asserts the fake xtrace client's captured
  `search` call passes `groupIds` covering the prior completed pairings'
  group ids as well as the current pairing's (guards the
  rematch-is-a-new-pairing-id trap above).
- Money-word safety: one test wires the real T3 pipeline — build the
  generator with `createGenerator` over a fake Anthropic-shaped client
  whose `parsed_output` includes a `$` line — and asserts that line is
  absent from the route's response (proving the route consumes T3's
  filtered Generator output; the route itself does not re-filter, so
  doubling the Generator directly would bypass the filter and fail this
  test by design).
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
  `callout_draft` added to `rate-limit-rules.ts` as
  `{ keyType: 'profile', limit: RL_CALLOUT_DRAFT_PROFILE_D, windowSeconds: DAY }`
  (constant from T1 — the file's header forbids hardcoding limits).
- `apps/web/lib/companion/callout-draft.ts` — logic.
- `apps/web/components/callouts/CalloutDraftButton.tsx` — `'use client'`;
  rendered by `CalloutPanel` beside each candidate's existing
  `CalloutButton` when the server passes `draftEnabled` (rivals page reads
  `isFlagEnabled('callout_draft')` and passes it into `CalloutPanel` as a
  new prop — server-reads-flag, passes-prop pattern).
- `apps/web/lib/copy.ts` — extend `calloutsCopy` with
  `draftButtonLabel`, `draftPickerHint`, `draftFailed` strings.
- `apps/web/lib/callout-share.ts` (new) + `apps/web/components/callouts/CalloutButton.tsx`
  (edited) — the existing `shareCalloutLink` helper is module-PRIVATE
  inside `CalloutButton.tsx` and its `nav.share({ url, title })` call has
  no `text` field, so "call the same share path with text" is impossible
  without this refactor: EXTRACT it to `lib/callout-share.ts` as
  `export function shareCalloutLink(url: string, title: string, text?: string)`,
  passing `text` through to `nav.share({ url, title, text })` when
  provided (and to the clipboard fallback as `"${text} ${url}"`);
  `CalloutButton.tsx` switches to importing it (behavior unchanged —
  it passes no `text`), and `CalloutDraftButton.tsx` imports the same
  function. No other `CalloutButton` behavior changes in this task.

**Route spec (`POST /api/v1/callouts/draft`, body
`draftCalloutBodySchema`):**
1–3. `assertSameOrigin(request)`; flag off → `ApiError('NOT_FOUND')`;
   claimed-only; parse body (`draftCalloutBodySchema`). No
   `enforceGetBackstop` (that is GET-only) and NO rate limit yet —
   see step 6.
4. Target authorization: fetch
   `priorPairingIds = completedPairingIdsBetween(db, profileId, target)`
   (T4's helper). Authorized when `priorPairingIds` is non-empty OR the
   target appears in `getCalloutCandidates(db, profileId)` (covers a
   current-week rival with no completed pairing yet); otherwise
   `ApiError('FORBIDDEN')` — no drafting against strangers. Do NOT check
   membership against a paginated history page — `getCalloutCandidates`
   is itself a fold over one `getNemesisHistoryPage` page capped at
   `NEMESIS_HISTORY_DEFAULT_LIMIT`, so alone it would falsely 403 a
   legitimate rival older than the 20 most-recent entries; the
   untruncated `priorPairingIds` check is the load-bearing half. Step 7
   reuses the already-fetched `priorPairingIds`.
5. `cacheKey = calloutDraftCacheKey(profileId, targetProfileId, etDay)`
   (T4's builder) — artifact hit returns stored drafts WITHOUT consuming
   the rate budget (same cache-before-limit rule and rationale as T6
   step 4: generation is already once-per-target-per-ET-day by cache
   key; charging hits would 429 repeat viewers for free reads).
6. Miss →
   `const limited = await enforceRateLimit('callout_draft', profileId); if (limited) return limited;`
   (returns the ready 429 or null; does not throw).
7. RECORD: lifetime W-L-D vs target via T4's `lifetimeRecordBetween` (the
   same helper T6 uses — T7 does not depend on T6 and must not wait for
   it; the shared aggregate lives in T4 precisely so neither route
   reimplements it). MEMORY: reuse `priorPairingIds` from step 4, with
   the pinned query literal
   `query = '<targetHandle> rivalry trash talk grudges history'`
   (same phrasing pattern as T6/T8's pinned literals), then
   run two searches: (a) user-scoped
   `{ query, userId: profileId, include: ['fact','episode'] }` — the
   challenger's own memory; (b) if any prior pairings exist, ONE
   group-scoped call
   `{ query, groupIds: priorPairingIds.map(pairingGroupId), include: ['fact','episode'] }`
   (Appendix A: `group_ids` are OR'd, so one call covers every past
   rivalry week; `include` matches T6/T8 — artifact-type memories are
   deliberately excluded on all three surfaces). Concatenate group
   results first, then user results,
   de-dupe by memory `id`, truncate to `COMPANION_SEARCH_LIMIT`.
8. Generate via `generator.calloutDrafts`; null →
   `ApiError('COMPANION_UNAVAILABLE', 'draft generation unavailable')`.
   Instantiate via `generatorFromEnv()` / `xtraceClientFromEnv()` like T6;
   a null `generatorFromEnv()` (unset `ANTHROPIC_API_KEY`) is treated the
   same as a null generation result → `COMPANION_UNAVAILABLE`; a null
   xTrace client → MEMORY `[]`, generation proceeds
   (T1 adds `COMPANION_UNAVAILABLE: 503` to `ERROR_CODES`; do NOT reuse
   the venue-pricing-specific `PRICE_UNAVAILABLE`). Rationale: unlike the
   passive banter panel,
   the user explicitly clicked — silent nothing is worse than an honest
   error toast.
9. Store the artifact with `content: { drafts, model, promptVersion }` —
   the `drafts` key is T4's pinned slot for this kind (NOT `lines`, which
   is banter's; a mismatched key would make the step-6 cache hit read
   `undefined` and silently regenerate forever). Row columns:
   `profileId` = the CHALLENGER's profileId (the rate-limited, cache-key
   subject — the target is identified only inside the cache key),
   `pairingId: null`, `seasonId: null` (drafts belong to the
   challenger-target relationship, not to any single pairing or season).
   Return the `draftCalloutResponseSchema` shape.

**Button spec:** click → POST → on success unwrap the §9.1 envelope —
drafts live at `json.data.drafts` (parse with `draftCalloutResponseSchema`
against `json.data`, or reuse `request()` from `lib/pick-client.ts` like
the T6 island) — then show the up-to-`COMPANION_DRAFT_MAX` drafts inline
(radio/tap-to-select), selected text is passed into the existing share flow:
call the same share path `CalloutButton` uses but with
`text: `${selectedDraft} ${share_url}`` — i.e., the button first creates
the callout via the existing `POST /api/v1/callouts` (unchanged), sending
`{}` as the body exactly like `CalloutButton` does (the schema's optional
`target_profile_id` stays unused — the draft targets only the share TEXT,
not the callout row; keep the created row identical to the non-draft
flow), then
shares link + draft together via the extracted
`shareCalloutLink(url, title, selectedDraft)` from `lib/callout-share.ts`
(see Files above — the pre-existing private helper had no `text`
parameter; the extraction is what makes this line implementable). On
draft failure: toast `calloutsCopy.draftFailed`,
and the plain share flow still works.

**Acceptance criteria:**
- Route tests: gate ladder (404/401/403/429 paths); stranger target → 403;
  a target beyond the first candidates page but with a completed pairing →
  authorized (pins the untruncated check); cache hit skips generator AND
  does not consume the rate limit (with the limit exhausted, a same-day
  repeat request for the same target still returns the cached drafts);
  degraded generator → 503 `COMPANION_UNAVAILABLE` envelope, and the
  plain callout flow is unaffected (separate route).
- Component test: drafts render after click; selecting one and sharing
  passes combined text to the (stubbed) share client; draft failure leaves
  the original `CalloutButton` functional.
- No test needed for the no-contract-change guarantee: state in the PR
  description that `createCalloutBodySchema` (`packages/core`) and the
  `callouts` table (`packages/db`) are untouched (no new columns/fields);
  the review loop verifies via diff.
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
- `apps/worker/test/registry.test.ts` — add `companion:season-recap` to
  `SPEC_JOBS` AND to `QUEUE_ONLY` (it has no cron), using the widened
  `/^(WS\d+|XH)-T\d+$/` owner regex (T5 makes the same regex change;
  whichever task lands second keeps it — the edit is idempotent).
- `apps/worker/scripts/run-season-recap.mjs` — thin script:
  `boss.send('companion:season-recap', { seasonId: process.argv[2] })`,
  mirroring `question-zero-drill/manual-schedule.mjs` (worker scripts are
  plain `.mjs`, not `.mts` — same PgBoss construction from
  `DATABASE_URL`), for the demo and ops.
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
- Resolve season: given id — recap it as-is, with NO `endsOn` check (an
  explicitly named season may still be running; T9's demo depends on
  this) — or, when `seasonId` is omitted, the latest `seasons` row with
  `kind='nemesis'` and `endsOn < today`, where `today` =
  `etDateString(now())`. No season resolves → log one warn line and
  return a zeroed report (not an error).
- Eligible profiles: distinct claimed profiles appearing in that season's
  `nemesis_pairings` (either side) — claimed = `profiles.kind = 'claimed'`
  (the `profile_kind` enum; the same check `apps/web/app/rivals/page.tsx`
  uses via `profile.kind === 'claimed'`). Filter with a WHERE on
  `profiles.kind`.
- Per profile (sequential loop — no concurrency; a season of hackathon
  scale is tens of profiles; each bounded by one LLM attempt + the xTrace
  search). Worst-case runs can still exceed pg-boss's default job
  expiration; that is safe, not a bug — a re-delivered run skips
  already-stored recaps (step 1) and `insertArtifactIdempotent` dedupes
  concurrent stores:
  1. Skip if the `recapCacheKey(seasonId, profileId)` artifact exists
     (T4's builder; idempotent re-runs).
  2. Build `RecapContext.stats` with plain SQL over `nemesis_pairings`
     (+ callouts counts). Pinned formulas — no other reading is correct:
     - `pairings`/`wins`/`losses`/`draws`: the profile's `completed`
       pairings in this season, bucketed by `winnerProfileId`
       (viewer = win, other side = loss, null = draw).
     - `bestStreak`: longest run of consecutive WINS over those completed
       pairings ordered by `weekStart` (a draw or a loss both break the
       run). Explicitly NOT `profiles.bestStreak`/`bestWinStreak` — those
       are daily-pick streaks; echoing them here would put a wrong number
       in RECORD-grounded text (ground rule 4).
     - `calloutsSent`: count of `callouts` rows with
       `challengerProfileId = profile` created within the season, where
       "within" compares ET calendar days:
       `etDateString(callout.createdAt) >= season.startsOn AND
       etDateString(callout.createdAt) <= season.endsOn` (both sides
       `YYYY-MM-DD` strings; `etDateString` from `@receipts/core`) — or
       equivalently in SQL, `created_at >= (startsOn 00:00 ET) AND
       created_at < (endsOn + 1 day 00:00 ET)`. A bare
       `createdAt <= endsOn` comparison is WRONG: `createdAt` is
       timestamptz while `startsOn`/`endsOn` are DATE columns, so the
       cast lands on midnight at the start of `endsOn` and silently
       excludes the season's entire final day (and skews the start
       boundary by the UTC/ET offset). Callouts carry no `seasonId` —
       this date window IS the season scoping.
     - `calloutsWon`: of those rows, the ones whose `pairingId` resolves
       to a `completed` pairing with `winnerProfileId = profile` (a
       callout "win" is winning the pairing the accepted callout created;
       the `callouts.status` enum has no win/loss).
     `verdictLines` = that profile's OWN narration
     lines, `verdict.narration[profileId]?.line`, chronological (see the
     verdict-shape note in XH-T5).
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
  3 weeks (verdict jsonb in the EXACT shape pinned in XH-T5 —
  `{ scoreA, scoreB, edgeA, edgeB, winner, excludedQuestionIds, narration: { [profileId]: { line, emphasis } } }`
  — with BOTH sides' narration lines populated; T6/T8 read
  `verdict.narration[profileId]?.line` via optional chaining, so a
  plausible-but-wrong shape degrades silently to empty verdict lines;
  alternate winners; final one `isRematch: true`), 8–10 pairing-thread posts with distinctly
  quotable trash talk, and one currently-active pairing for this week.
  For each concluded pairing ALSO set the row columns the same way
  `updatePairingConclusion` does: `status: 'completed'`,
  `scoreA`/`scoreB` (matching the verdict), `edgeA`/`edgeB`, and
  `winnerProfileId` consistent with `verdict.winner` (null only for a
  draw). T4's `lifetimeRecordBetween`/`completedPairingIdsBetween` and
  T8's stats bucket by the `winner_profile_id`/`status` COLUMNS, not the
  jsonb — a seed that populates only the jsonb yields a demo where
  narration lines claim wins while RECORD reads 0-0-3 all-draws,
  silently, since everything downstream is fail-open.
  (Callout candidates need no extra seeding — they are derived from the
  concluded pairings via `getCalloutCandidates`; verify the seed makes
  each profile appear in the other's candidates.) Print the profile
  ids/handles, pairing ids, and the SEASON id — the recap job must be
  invoked with it (the seeded season is still running, so T8's default
  "latest ended season" resolution would find nothing).
- `docs/xtrace-hackathon-demo.md` — the runbook: env vars needed (real
  `XTRACE_API_KEY` + `ANTHROPIC_API_KEY`), flag env lines, exact command
  sequence (seed → run `companion:ingest` once via
  `node apps/worker/scripts/run-companion-ingest.mjs` (T5 ships it) → hit
  banter route as each profile → run the recap job with the seeded season
  id printed by the seed script:
  `node apps/worker/scripts/run-season-recap.mjs <seasonId>` — the
  explicit id is required, T8's given-id path skips the ended-season
  check → walk the three surfaces), what each demo
  beat shows the judges, and the reset procedure (truncate the two
  companion tables — `companion_artifacts`, `companion_ingest_log` — and
  re-run). Include the "facts are authoritative /
  memory is color" one-liner for the pitch.

**Spec notes:**
- Script must be idempotent (re-run safe). Either detect a prior run and
  exit early exactly like `seed-fixtures.mts` does (select a sentinel row
  by fixed handle/slug; if present, print the existing ids and
  `process.exit(0)` — note the template does NOT upsert; its inserts are
  plain `db.insert(...).values(...)` behind that early-exit), or upsert on
  fixed ids — the early-exit is the established pattern.
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

## XH-T10 — Fix: real xTrace groups (client + DB storage)

**Why this exists:** T2's client and T5/T6/T7's callers all pass
`` `pairing:${pairingId}` `` as a `group_ids` entry, on the assumption
(baked into the original Appendix A, now corrected below) that group ids
were caller-chosen free-form strings. They are not: `group_ids` only
accepts ids previously returned by `POST /v1/groups`; an unrecognized
string is silently soft-skipped at ingest. The practical effect: every
group-scoped `search()` call in the shipped app — the banter panel, the
callout draft assist — has always returned `[]`, in production, since the
`companion:ingest` job first shipped (XH-T5). Nothing crashed because the
whole companion feature is deliberately fail-open (ground rule 3): an
empty memory list looks identical to "xTrace has nothing yet," so this
went unnoticed through T5–T9 and the post-merge demo. Confirmed empirically
against the real API (2026-07-24): group-scoped search returns `[]` for a
made-up group id and non-empty once memories are tagged with a real,
server-issued `grp_...` id from `POST /v1/groups`.

This task adds the plumbing (xTrace client method + a persisted
pairing→group-id mapping) with NO caller changes — it is inert on its own,
so it can merge independently and be reviewed as pure addition. XH-T11
wires it in.

**Files:**
- `packages/companion/src/xtrace/schemas.ts` — add:
  ```ts
  export const xtraceGroupSchema = z
    .object({ id: z.string() })
    .passthrough();
  export type XtraceGroupWire = z.infer<typeof xtraceGroupSchema>;
  ```
  (The real response also carries `object`, `name`, `prompt`, `status`,
  `created_at`, `updated_at` — `.passthrough()` means we don't need to
  enumerate them; `id` is the only field any caller reads.)
- `packages/companion/src/xtrace/client.ts`:
  - Add to `XtraceClient`:
    ```ts
    export interface CreateGroupArgs { name: string }
    export interface XtraceClient {
      ingest(args: IngestArgs): Promise<boolean>;
      search(args: SearchArgs): Promise<XtraceMemory[]>;
      createGroup(args: CreateGroupArgs): Promise<string | null>;
      //  ^ fail-open like the other two methods: null on any failure
      //    (non-2xx, timeout, network error, zod parse failure) — NEVER
      //    throws. Returns the server-issued group id on success.
    }
    ```
  - Implement inside `createXtraceClient` reusing the existing
    `postWithRetry` helper (same retry/backoff/timeout/logging behavior as
    `ingest`/`search` — do not write a second HTTP path):
    ```ts
    async function createGroup(args: CreateGroupArgs): Promise<string | null> {
      const body = await postWithRetry('/v1/groups', {
        name: args.name,
        app_id: opts.appId,
      });
      if (body === undefined) return null;
      const parsed = xtraceGroupSchema.safeParse(body);
      if (!parsed.success) {
        logger('xtrace POST /v1/groups: response failed schema validation', parsed.error);
        return null;
      }
      return parsed.data.id;
    }
    ```
    Add `createGroup` to the object returned at the bottom of
    `createXtraceClient` (alongside `ingest`/`search`).
  - No change to `pairingGroupId`/`pairingConvId`/`seasonConvId` — they
    still name conversations and (after T11) the group's `name` field for
    debugging; they are no longer used as the group ID itself.
- `packages/companion/test/xtrace-client.test.ts` — add cases mirroring the
  existing `ingest`/`search` coverage: `createGroup` sends `{name, app_id}`
  and returns the parsed `id` on 2xx; 500 → retried `maxRetries` times then
  `null`; 400 → not retried, `null`; malformed JSON → `null`, not retried.
  No test throws.
- `packages/db/src/schema/companion.ts` — add:
  ```ts
  export const companionXtraceGroups = pgTable('companion_xtrace_groups', {
    pairingId: uuid('pairing_id')
      .primaryKey()
      .references(() => nemesisPairings.id),
    xtraceGroupId: text('xtrace_group_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  });
  ```
  One row per pairing, `pairing_id` as the primary key (a pairing has
  exactly one group, ever — no composite key needed, unlike
  `companion_ingest_log`'s two-source-kind shape). No change needed to
  `schema/index.ts` — it already does `export * from './companion.js'`,
  so the new table is re-exported automatically.
- Migration: `pnpm --filter @receipts/db db:generate`; commit the generated
  SQL + meta snapshot. Never hand-edit `0001_init.sql`.
- `packages/db/src/repositories/companion.ts` — add:
  ```ts
  export async function getXtraceGroupId(db: Db, pairingId: string): Promise<string | null>
  //  ^ SELECT xtrace_group_id WHERE pairing_id = $1, or null.

  export async function listXtraceGroupIdsForPairings(db: Db, pairingIds: string[]): Promise<string[]>
  //  ^ SELECT xtrace_group_id WHERE pairing_id = ANY($1). Empty input →
  //    empty output, no query. Pairings with no row yet are simply absent
  //    from the result — never an error; the caller (T11) just gets fewer
  //    group ids to search, exactly like memory-not-ingested-yet today.

  export async function insertXtraceGroupIdIdempotent(
    db: Db,
    pairingId: string,
    xtraceGroupId: string,
  ): Promise<string>
  //  ^ INSERT ... ON CONFLICT (pairing_id) DO NOTHING, then SELECT and
  //    return whatever is NOW stored for pairingId — mirrors
  //    insertArtifactIdempotent's idiom exactly. Load-bearing detail: the
  //    returned value may NOT be the xtraceGroupId the caller just passed
  //    in — if two ingest runs race to create a group for the same
  //    never-before-seen pairing, both successfully call xTrace's
  //    POST /v1/groups (two real, valid, but now-orphaned groups exist
  //    server-side), and only one of the two rows wins the DB insert.
  //    Callers MUST use the function's return value for all subsequent
  //    tagging, not the id they created — the discarded group is harmless
  //    (unused, never referenced again) but continuing to use it after
  //    losing the race would split one pairing's memory across two
  //    groups, permanently.
  ```
- `packages/db/src/testing/factories.ts` — add `buildCompanionXtraceGroup`
  (defaults: a fresh `pairingId`, `xtraceGroupId: 'grp_test'`) for T11's
  tests, following the existing `buildCompanionArtifact` pattern right
  above it.

**Acceptance criteria:**
- `pnpm --filter @receipts/db db:check` clean; migration applies on a
  fresh Postgres (integration test in `packages/db/test/integration/`,
  same inline-setup pattern as T4's: `TEST_DATABASE_URL`, migrate,
  truncate).
- Integration tests: `insertXtraceGroupIdIdempotent` called twice
  concurrently for the same `pairingId` with two DIFFERENT `xtraceGroupId`
  values yields one row, and BOTH calls' return values equal that one
  stored value (i.e., the second caller sees the first caller's id, not
  its own) — this is the race-safety property the "Files" note above
  describes; a test that only checks "one row exists" would miss it.
  `getXtraceGroupId` on an unknown pairing → null. `listXtraceGroupIdsForPairings`
  with a mix of known/unknown/empty pairing ids returns only the known
  ones' group ids, in any order, and `[]` for an empty input array without
  querying (assert via a spy or just trust the early return — either way,
  test the empty-input behavior explicitly).
- `packages/companion` unit tests above pass.
- `pnpm verify` green.

**Out of scope:** using any of this from the ingest job or search callers
(T11); backfilling group tags onto memories already ingested under the
broken scheme (see T11's note on this — those facts remain user-scoped
only, permanently, unless someone manually clears
`companion_ingest_log` rows to force re-ingestion).

---

## XH-T11 — Fix: wire real group ids into ingest + search

**Goal:** Replace every `pairingGroupId(id)` call that's used as an actual
`group_ids` value with a real, T10-persisted xTrace group id — get-or-create
in the writer (the ingest job, the only place that tags memory into a
group), read-only lookup in the two readers (banter, callout draft).
`companion:season-recap`'s `xtrace.search()` call is `userId`-scoped only
and untouched by this bug — do not add group logic there; there is nothing
to fix.

**Files:**
- `apps/worker/src/jobs/companion-ingest.ts`:
  - Import `getXtraceGroupId` and `insertXtraceGroupIdIdempotent` from
    `@receipts/db`.
  - Add a per-run resolver, keyed so a pairing hit by BOTH the verdict loop
    and the post loop (its posts and its verdict are ingested in the same
    run — this happens routinely, since `listCandidatePairingPostsForIngest`
    covers `active` AND `completed` pairings, independent of which
    pairings have a freshly-concluded verdict this run) only ever resolves
    once:
    ```ts
    async function resolveGroupId(
      db: Db,
      xtrace: XtraceClient,
      pairingId: string,
      cache: Map<string, string | null>,
    ): Promise<string | null> {
      if (cache.has(pairingId)) return cache.get(pairingId)!;
      const existing = await getXtraceGroupId(db, pairingId);
      if (existing) {
        cache.set(pairingId, existing);
        return existing;
      }
      const created = await xtrace.createGroup({ name: `pairing:${pairingId}` });
      if (!created) {
        cache.set(pairingId, null);
        return null;
      }
      const winning = await insertXtraceGroupIdIdempotent(db, pairingId, created);
      cache.set(pairingId, winning);
      return winning;
    }
    ```
    `runCompanionIngest` constructs ONE `groupCache = new Map<string,
    string | null>()` (function-local, not module-level — a fresh map
    every run; nothing here should survive across runs, unlike the DB row
    it caches) and passes it down to both loops. This means
    `ingestOnePairingVerdict` and `ingestOnePost` — which currently do NOT
    take a cache parameter — each gain one:
    ```ts
    async function ingestOnePairingVerdict(
      db: Db,
      xtrace: XtraceClient,
      pairing: ConcludedPairing,
      at: Date,
      state: RunState,
      groupCache: Map<string, string | null>,   // new parameter
    ): Promise<boolean> { ... }

    async function ingestOnePost(
      db: Db,
      xtrace: XtraceClient,
      post: CompanionPostIngestCandidate,
      at: Date,
      state: RunState,
      groupCache: Map<string, string | null>,   // new parameter
    ): Promise<boolean> { ... }
    ```
    Update both call sites inside `runCompanionIngest`'s two loops to pass
    `groupCache` through. Each function calls `resolveGroupId(db, xtrace,
    <pairingId>, groupCache)` ONCE at its own top, before building any
    ingest args — for `ingestOnePairingVerdict` that's `pairing.id`
    (resolved once, then reused for BOTH side A's and side B's
    `buildVerdictIngestArgs` call — they tag the same pairing's group, so
    there is exactly one resolution per pairing per run even though there
    are two ingest calls); for `ingestOnePost` that's `post.pairingId`.
  - `buildVerdictIngestArgs`/`buildPostIngestArgs` currently call
    `pairingGroupId(pairing.id)` / `pairingGroupId(post.pairingId)`
    directly to build `groupIds: [...]`. Both gain a `groupId: string`
    parameter (the caller's already-resolved id) and use `groupIds:
    [groupId]` instead — keep them synchronous/pure, exactly as today;
    only the callers (`ingestOnePairingVerdict`/`ingestOnePost`) do the
    `await`ing.
  - **If `resolveGroupId` returns `null`** (xTrace's `createGroup` failed,
    e.g. an outage): treat the source as a failed ingest attempt for this
    run WITHOUT calling `xtrace.ingest()` at all — there is no group id to
    tag it with, so there is nothing useful to send. Do NOT call
    `markIngested` for it (so it retries next run). Add one small helper
    next to `attemptIngest` to keep the circuit-breaker bookkeeping in
    exactly one place:
    ```ts
    function recordIngestFailure(state: RunState): void {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.aborted = true;
      }
    }
    ```
    (`attemptIngest`'s existing failure branch — `state.consecutiveFailures
    += 1; if (...) state.aborted = true;` — becomes a call to this new
    helper too, so there is one failure-bookkeeping path, not two
    near-duplicates.) In `ingestOnePairingVerdict`/`ingestOnePost`, when
    `resolveGroupId` returns `null`: call `recordIngestFailure(state)` and
    return `false` (verdict) / `false` (post) immediately — same shape as
    an ingest failure, just skipping the HTTP call. This makes a sustained
    group-creation outage trip `MAX_CONSECUTIVE_FAILURES` the same way a
    sustained ingest outage already does, instead of silently skipping all
    200 sources one-by-one with no abort.
  - Known, accepted gap (document with a code comment where
    `companionIngestLog` is checked, not just in this task doc): pairings
    already marked ingested under the OLD (broken) scheme keep their
    `companion_ingest_log` row and will never be re-ingested, so their
    facts remain permanently user-scoped-only in xTrace — they were never
    actually group-tagged (the old string was silently ignored), so
    nothing regresses, but they also don't retroactively gain group
    scoping. This is fine at current (near-zero) production data volume;
    do not build an automated backfill for this task — if a real backfill
    is ever wanted, the manual remedy is deleting the relevant
    `companion_ingest_log` rows so the normal candidate query re-selects
    them.
- `apps/web/lib/companion/banter.ts`:
  - `buildBanterContext` currently does
    `groupIds: [...pairingIds].map(pairingGroupId)`. Replace with
    `groupIds: await listXtraceGroupIdsForPairings(db, [...pairingIds])`
    (import from `@receipts/db`; drop the now-unused `pairingGroupId`
    import from `@receipts/companion`). Pairings with no persisted group
    id yet (never ingested, or ingested before T11 shipped) simply
    contribute nothing to the search — same fail-open shape as today,
    just for the right reason.
- `apps/web/lib/companion/callout-draft.ts`:
  - `searchDraftMemory` currently does
    `groupIds: priorPairingIds.map(pairingGroupId)`. Replace with a
    `listXtraceGroupIdsForPairings(db, priorPairingIds)` lookup: add `db:
    Db` as `searchDraftMemory`'s first parameter, and update its one call
    site inside `generateAndCacheCalloutDraft` (which already receives
    `db` as its own first parameter) to pass `db` through as the new first
    argument. Skip the group-scoped `xtrace.search()` call entirely when the
    resolved list is empty (same `priorPairingIds.length > 0` guard
    already there, just gated on the resolved ids instead of the raw
    pairing ids — an empty `groupIds` array in a search call is
    pointless work, not an error, but there's no reason to make it).
- Test-double updates (adding `createGroup` to `XtraceClient` is a
  compile-time breaking change for every fake implementing the full
  interface — all of these currently define only `ingest`/`search`):
  - `apps/worker/test/integration/companion-ingest.test.ts` —
    `makeCapturingXtrace` and `makeScriptedXtrace` (two factories) each
    need `async createGroup() { return 'grp_test'; }` added alongside
    their existing `ingest`/`search`. This file's own test cases also need
    new coverage (extend `makeCapturingXtrace`'s captured-calls shape, or
    add a sibling fake, so `createGroup` calls are counted, not just
    `ingest` calls): (a) a pairing whose verdict AND whose posts are both
    candidates in the SAME `runCompanionIngest` call resolves its group id
    via `xtrace.createGroup` exactly ONCE, not twice — this is what the
    shared `groupCache` is for; (b) a pairing pre-seeded with an existing
    `companion_xtrace_groups` row (via the new `buildCompanionXtraceGroup`
    factory, inserted before calling `runCompanionIngest`) never calls
    `xtrace.createGroup` at all — `resolveGroupId`'s `getXtraceGroupId`
    read finds it first; (c) a fake whose `createGroup` returns `null`
    causes that pairing's verdict/post to be skipped (not marked
    ingested in `companion_ingest_log`) and increments
    `state.consecutiveFailures` toward the existing
    `MAX_CONSECUTIVE_FAILURES` abort.
  - `apps/worker/test/integration/companion-season-recap.test.ts` — its
    one fake client object needs the same one-line addition (this job
    doesn't use groups, but the interface is shared).
  - `apps/web/test/companion-banter-lib.test.ts` — its fake client object
    needs the `createGroup` addition, BUT this file mocks `@receipts/db`
    entirely (`vi.mock('@receipts/db', ...)`, no real Postgres — see its
    own header comment) rather than hitting a real database, unlike
    `companion-ingest.test.ts` above. Add
    `const mockListXtraceGroupIdsForPairings = vi.fn();` alongside the
    file's other `mock*` fns, wire it into the `vi.mock('@receipts/db', ...)`
    factory as `listXtraceGroupIdsForPairings: (...args: unknown[]) =>
    mockListXtraceGroupIdsForPairings(...args)`, and add a test that
    configures `mockListXtraceGroupIdsForPairings.mockResolvedValue(['grp_a',
    'grp_b'])` then asserts the fake xtrace client's captured `search()`
    call received `groupIds: ['grp_a', 'grp_b']` — i.e., whatever the
    (mocked) repository function returns, verbatim, NOT anything derived
    from the pairing id string.
  - `apps/web/test/callout-draft-lib.test.ts` — BOTH fake client objects in
    this file need the `createGroup` addition, and (same reasoning as
    above) this file also mocks `@receipts/db` entirely — add
    `mockListXtraceGroupIdsForPairings` the same way, wire it into this
    file's own `vi.mock('@receipts/db', ...)` factory, and add the
    equivalent captured-`groupIds`-equals-mock-return-value assertion for
    `searchDraftMemory`'s call shape.
- `docs/xtrace-hackathon-tasks.md` Appendix A — see the correction above
  this task's own section; already applied as part of this change, not a
  separate step.

**Acceptance criteria:**
- All test updates above pass; `pnpm verify` green.
- Manual/integration confirmation (record the result in the PR
  description, do not just assert it): seed a pairing, run
  `companion:ingest`, confirm a `companion_xtrace_groups` row exists for
  it, then confirm a group-scoped `search()` for that pairing's rivalry
  returns non-empty once xTrace has finished server-side extraction. This
  is genuinely async server-side and its latency was NOT precisely
  measured for a single small pairing this session (the closest measured
  data point — a 159-message stress-test corpus this session's XH-T10/T11
  investigation ran — needed 2–4 minutes before search reliably found
  planted facts); poll every ~30s for a few minutes rather than assuming
  any fixed delay, and do not treat a still-empty result at 30s as a test
  failure on its own.
- No change in behavior for anyone who never worked (or breaks) before:
  the `userId`-scoped searches in `callout-draft.ts` and
  `companion-season-recap.ts` are untouched.

**Out of scope:** the backfill discussed above; any change to
`companion:season-recap` (it was never broken); polling xTrace's async
ingest-job status (`ingest()` stays fire-and-forget, unchanged).

---

## Appendix A — xTrace API (pinned 2026-07-23, from api.staging.xtrace.ai/openapi.public.json;
groups section corrected 2026-07-24 — see the note below and XH-T10/T11)

Base URL: `https://api.production.xtrace.ai`. Auth: `x-api-key: <key>`
header (Bearer also supported). Error shape:
`{ detail: { code, message } }`; 429 carries `Retry-After`.

**Groups are NOT free-form strings (correction — the rest of this
appendix originally showed `group_ids: ["pairing:{id}"]` as if callers
could invent their own group ids; they cannot).** A group must be created
first via `POST /v1/groups` — request `{ name: string, prompt?: string,
app_id }`, response `{ object:'group', id: 'grp_...', name, prompt,
status, created_at, updated_at }` (verified empirically against the real
API 2026-07-24). Passing an unrecognized string in `group_ids` at ingest
is silently soft-skipped (not an error — this is exactly how the bug XH-T10/
T11 fix went unnoticed: every group-scoped `search()` in the shipped app
returned `[]` from day one, indistinguishable from "no memory yet" under
this app's fail-open design). The original "Not used at hackathon scope"
line below wrongly cut the groups API as optional — it is required for any
group-scoped ingest/search to do anything at all; XH-T10 adds client
support, XH-T11 wires it in.

**POST /v1/memories** (ingest; async — 202 returns
`{ object:'ingest_job', id, status }`; we never pass `?wait=true`):
```json
{
  "messages": [{ "role": "user", "content": "…", "date": null }],
  "user_id": "<profiles.id>",        // required
  "conv_id": "pairing:{id}:{pid}",   // required
  "app_id": "<XTRACE_APP_ID>",
  "group_ids": ["grp_..."],          // server-issued only, from POST /v1/groups — see above
  "agent_id": null
}
```
Server auto-classifies into facts / artifacts / episodes; no
pre-classification. Note (XH-T10/T11): some memories are classified
`personal` and are never group-tagged regardless of `group_ids` sent —
group-scoped search over rivalry memory will not surface everything a
same-user-scoped search would; this is a real gap in the group lane, not a
bug in either the client or T11's fix, and is out of scope for T11 to
close.

**POST /v1/memories/search**:
```json
{
  "query": "…",                       // 1–4000 chars, required
  "mode": "retrieve",                 // we always use retrieve, not compose
  "user_id": "<profiles.id>" | null,
  "group_ids": ["grp_..."],           // OR'd; server-issued only, see above
  "app_id": "<XTRACE_APP_ID>",
  "include": ["fact", "episode"]
}
```
Response: `{ object:'search', data: [{ id, type, text, user_id, group_ids,
score, created_at, … }], … }` — ranked; `score` may be null.

Not used at hackathon scope (explicit cut, revisit before any real launch):
`PATCH /v1/memories/{id}` (group re-tagging, needed for block-revocation),
`DELETE /v1/memories/{id}` (needed for account-deletion cascade),
`GET /v1/memories` (list), usage/webhooks APIs. (Groups moved OUT of this
cut list 2026-07-24 — see the correction above; `POST /v1/groups` is now
in scope via XH-T10.)

## Appendix B — Claude API notes (pinned)

- SDK `@anthropic-ai/sdk` (TypeScript). Model `claude-opus-4-8` via
  `COMPANION_MODEL`.
- No `temperature`/`top_p`/`top_k` (400 on this model). Omit `thinking`
  config. Structured outputs via `client.messages.parse` +
  `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`;
  `parsed_output` is null on parse failure — treat as degraded.
- Handle `stop_reason === 'refusal'` before reading content.
- Typed errors, instanceof checks most-specific first (TS SDK):
  `RateLimitError`, then `APIConnectionError` (it subclasses `APIError`
  in the TS SDK — check it before the base), then `APIError`. There is
  no `APIStatusError` in the TypeScript SDK (that class is Python-only).
- TS client `timeout` option is milliseconds.
