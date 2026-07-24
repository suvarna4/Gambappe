# WS27 — Rumor Radar: upvote-weighted Reddit sentiment odds for LeBron's next team

Spec home for the `WS27-T*` tasks in the workstream lock registry
(`node scripts/workstream-lock.mjs list-ready`). Canonical over chat drafts. Follows the
design doc's §0 / §19.4 cross-cutting rules: one task per PR, `pnpm verify` gate,
contract-change PRs marked as such.

The pitch: mine every top Reddit post about LeBron James's 2026 free agency, extract
per-comment team stances, weight them by **upvotes**, aggregate into a probability
distribution over destination teams ("crowd odds"), and track how that distribution
diverges from **Polymarket's real-money odds** — with all tunable behavior stored as a
versioned **xTrace skill** trained by walk-forward replay of _resolved_ past
free-agency sagas. The live market resolves by 2026-10-31; at resolution both the crowd
odds and the market odds get graded by reality (Brier), which is a sealed exam nobody
can leak because nobody knows the answer yet.

## Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-24 | Owner: **pivot** — the WS26 Phase X2 continuation (WS26-T10 xTrace wiring for football personas, WS26-T16 World Cup exam) is scrapped in favor of WS27. Both tasks withdrawn from the registry; the shipped T9/T14/T15 code stays (T14's harness pattern is reused here). Revive by re-adding. |
| 2026-07-24 | Owner: **capture-once at ≥2 hours** — a post's comment tree is fetched exactly once, when the post is at least 2 hours old; that snapshot is the permanent record. No re-snapshotting, no score-evolution tracking. Late-arriving comments are simply absent (they carry low scores anyway).   |
| 2026-07-24 | Live comment scores require **Reddit OAuth app credentials** (owner will supply when T6 starts — remind them). Historical training uses Arctic Shift, which preserves real Pushshift-era (pre-2023) upvotes. Secrets: `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`, env-only, never committed.  |
| 2026-07-24 | xTrace access goes through the existing `@receipts/companion` client (`createXtraceClient` — the only file allowed to call the xTrace HTTP API). WS27 adds no second client.                                                                                                                   |

## 1. Verified facts (sandbox probes, 2026-07-24)

Every load-bearing external dependency was probed before this plan was written:

- **Polymarket gamma API is reachable, no auth.** The target market exists:
  `nba-lebron-james-next-team` (~$40M volume, 36 per-team binary markets, event ends
  2026-10-31). Prices at probe time: MIA 44.4%, CLE 26.7%, GSW 15.9%, PHI 8.9%,
  MIN 2.5%, LAL 0.4%.
- **Reddit's public JSON is blocked** from datacenter IPs (edge "Blocked" page), but the
  OAuth token endpoint (`/api/v1/access_token`) responds — a registered script app gets
  the official API and live scores. Fallback if OAuth is also IP-blocked: owner runs the
  fetch script locally and drops the JSONL in.
- **Arctic Shift** (`arctic-shift.photon-reddit.com`) is reachable and searchable.
  Empirically: it ingests comments minutes after creation, so **recent comment scores
  are frozen at ~1** (verified on a month-old thread), but **pre-2023 Pushshift-era
  comments carry real scores** (verified: 2018 LeBron-decision thread, top comment
  score 85). Post scores are accurate even for recent posts. `sort_type` supports only
  `default`/`created_utc` — rank by score client-side.
- **Naive v0 sanity check** (100 recent r/nba post titles, team-alias mentions weighted
  by `log1p(post score)`): MIA 42.8 / GSW 24.0 / CLE 17.0 / PHI 8.0 / LAL 4.8 /
  MIN 2.9 — within ~2pts of Polymarket on MIA/PHI/MIN with zero stance detection. The
  big misses are exactly stance failures: LAL over-weighted because Reddit mentions the
  team he is _leaving_. That gap is what T2 exists to close.

## 2. Architecture

Five stages; each maps onto one or two tasks.

```
A. Corpus          B. Extraction         C. Weighting+aggregation   D. Skill        E. Comparison
Arctic Shift  ──►  (team, stance, conf)  Σ stance·w per team   ──►  RumorSkill ──►  vs Polymarket
Reddit OAuth       per comment           softmax → crowd odds       (xTrace)        daily deltas, KL,
(≥2h capture-once) lexicon+negation      w = f(upvotes, sub, age)   walk-forward    graded at resolution
```

**A — Corpus.** Two fetchers, one snapshot format (JSONL, one file per post, keyed by
post id, `fetchedAt` audit stamp). _Historical_: Arctic Shift for resolved sagas —
LeBron 2014 (→CLE), Durant 2016 (→GSW), LeBron 2018 (→LAL), Kawhi 2019 (→LAC),
Kyrie 2019 (→BKN), Harden 2021 (→BKN) — real upvotes, fixed archive. _Live_: Reddit
OAuth sweep over r/nba, r/lakers, r/heat, r/clevelandcavs, r/warriors, r/sixers for
LeBron posts; capture-once at ≥2h (decision log). Corpus JSONL is gitignored
(re-fetchable); tiny derived files (odds history, skills) are committed.

**B — Extraction (deterministic v1).** Pure function per comment:
team-alias lexicon (nicknames, cities, indirect refs — "homecoming"→CLE,
"south beach"→MIA), negation/hypothetical windows ("won't", "no cap space", "if he"),
stance cues ("has agreed"+, "leverage"−, "smokescreen"−) →
`{team, stance ∈ [−1,1], confidence}[]`. One comment can emit opposite stances for two
teams. Most comments emit nothing — dropping noise cleanly matters as much as scoring
the rest. Deterministic on purpose: every output is reproducible and auditable. (An
LLM-extraction v2 would be a drop-in upgrade behind the same output shape; not in v1.)

**C — Weighting + aggregation.**
`w = log1p(max(0, upvotes))^α · homerDiscount(subreddit, team) · recencyDecay(age)`.
Per team: `score = Σ stance·conf·w`; negative totals floor at a small epsilon; softmax
with temperature τ over candidate teams → the **crowd odds**. All knobs (α, discounts,
half-life, τ, cue weights) live in the skill, never hardcoded.

**D — The skill.** Same philosophy as `CpuMemory` (packages/engine/src/cpu-memory.ts):
a versioned JSON blob, pure update functions, bounded tuning steps, `cutoff` audit
stamp. Trained by **walk-forward replay** of the resolved sagas: at each replay day D,
compute crowd odds from comments dated ≤ D only, grade against the saga's eventual
outcome (log-loss/Brier), take a bounded parameter step. Leakage discipline is
structural, exactly as in `@receipts/sim`: the scoring path never sees the outcome;
outcomes reach tuning only through an `observe` call after the replay day's odds are
recorded. Each saga's end state is uploaded to xTrace as a skill version —
skill@2014 → skill@2016 → … → skill@live — a versioned lineage with cutoffs.

**E — Comparison.** Daily: recompute crowd odds over the accumulated corpus (new posts
keep aging past 2h and entering; old posts are never re-touched), snapshot Polymarket's
per-team prices (de-vig by proportional normalization, as in
`packages/sim/src/football-data.ts`), append both to a committed
`odds-history.jsonl`. Metrics: per-team delta, KL(crowd‖market), top-pick agreement.
At resolution: Brier(crowd) vs Brier(market-close) — the headline.

## 3. Skill schema

```ts
interface RumorSkill {
  version: 1;
  /** Newest data this skill has trained on (YYYY-MM-DD) — the audit stamp. */
  cutoff: string;
  /** Alias → team code additions/overrides on top of the built-in lexicon. */
  lexiconDeltas: Record<string, string>;
  /** Cue phrase → stance weight in [−1, 1]. */
  stanceCueWeights: Record<string, number>;
  /** Upvote exponent α in w = log1p(ups)^α. */
  upvoteAlpha: number;
  /** Fan-sub discount when the comment's subreddit is the mentioned team's sub. */
  homerDiscount: number;
  /** Recency half-life in days for comment age decay. */
  recencyHalfLifeDays: number;
  /** Softmax temperature. */
  temperature: number;
  /** Per-saga training record: sagaId → { finalLogLoss, days, outcome }. */
  record: Record<string, { logLoss: number; days: number; outcome: string }>;
}
```

Bounded tuning (`RUMOR_TUNE_MAX_STEP`) moves one knob at a time toward the grid argmax
of replay log-loss, mirroring `tuneParams` in cpu-memory. Defaults must reproduce a
documented untrained baseline exactly (pinned by test), so trained-vs-untrained
comparisons are always available.

## 4. xTrace integration

Via `createXtraceClient` from `@receipts/companion` (fail-open contract: ingest/search
never throw). One group per project (`createGroup({ name: 'rumor:lebron-2026' })`),
skill snapshots ingested as memories under `conv_id = rumor:skill:<version>`, with
`agentId: 'rumor-radar'`; the demo's lineage panel reads them back via `search`. Needs
`XTRACE_API_KEY` + `XTRACE_APP_ID` in env (already provisioned for the companion work;
Fly secrets, never committed).

## 5. Tasks

All code in a new Node-only workspace package **`packages/rumor`** (`@receipts/rumor`),
modeled on `@receipts/sim` (tsc build, vitest, scripts/ with undici
`EnvHttpProxyAgent` for proxy-aware fetch). Never bundled into web or worker.

| Task    | Phase | Depends | Deliverable                                                                                                                                                                                                                            |
| ------- | ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS27-T1 | R0    | —       | Package scaffold + snapshot format + **Arctic Shift fetcher** (historical sagas, saga manifest with outcomes) + fixture corpus checked in for tests.                                                                                   |
| WS27-T2 | R0    | T1      | **Extractor**: built-in team lexicon (30 teams + nicknames + indirect refs), negation/hypothetical windows, stance cues → per-comment `{team, stance, confidence}[]`. Unit-tested against hand-annotated real comments from fixtures.  |
| WS27-T3 | R0    | T2      | **Weighting + aggregation + `RumorSkill`**: upvote curve, homer discount, recency decay, softmax; skill schema + defaults + `isRumorSkill` validation; untrained-baseline pin test.                                                    |
| WS27-T4 | R1    | T3      | **Walk-forward backtest harness**: replay a saga day-by-day, structural leakage discipline, log-loss/Brier per day, trained-vs-untrained report. Runs on the T1 historical corpus.                                                     |
| WS27-T5 | R1    | T4      | **Training + xTrace versioning**: bounded tuning across sagas in chronological order; upload each skill version via the companion client; script to list/export the lineage.                                                           |
| WS27-T6 | R2    | T3      | **Live pipeline**: Reddit OAuth fetcher (≥2h capture-once), daily crowd-odds recompute, Polymarket snapshot (de-vigged), committed `odds-history.jsonl`, divergence metrics. **Blocked on owner-supplied Reddit creds — remind them.** |
| WS27-T7 | R2    | T5, T6  | **Demo artifact**: crowd odds vs Polymarket over time, per-team gap chart, annotated example comments with weights, skill-lineage panel. Follows the existing hackathon demo's design system.                                          |

T1–T5 have no external blockers. T6 is where Reddit credentials are needed.

## 6. Cross-cutting rules

- One task per PR, branch `claude/ws27-t<n>-<slug>`, squash-merge on green,
  `pnpm verify` (or the task-relevant subset: prettier, eslint, typecheck, vitest).
- Secrets (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `XTRACE_API_KEY`,
  `XTRACE_APP_ID`) are env/Fly-secret only, never committed, all on the
  rotate-before-launch list.
- Data hygiene: raw corpus JSONL gitignored; derived tiny artifacts (odds history,
  skill JSON, saga manifest) committed. Nothing in the corpus is PII beyond public
  Reddit usernames, which are dropped at snapshot time (author field hashed).
- The extractor and aggregator are pure functions over plain data — no I/O — so they
  are testable and replayable, per the engine package's rules.
