# xTrace hackathon tasks — review log & process

Status: NOT strictly converged; loop running (operator-approved
run-until-clean, 2026-07-23). 76 fixes total across five full panel
rounds (30 + 22 + 8 + 8 + 3 + 2) and a main-session pass (3).
Finding counts are decaying (30 → 22 → 8 → 8 → 3 → 2); the loop continues
until a panel round returns zero findings.

This file is the durable state of the adversarial review process for
`docs/xtrace-hackathon-tasks.md`. It exists so the process can be resumed by
any future session (human or agent) after quota exhaustion or a dead
container: everything needed to continue lives on this branch
(`claude/xtrace-integration-brainstorm-t1chgj`), committed and pushed at every
checkpoint.

## Process (mandatory for every edit to the task doc)

Protocol v2 (single-round; supersedes the v1 multi-round loop after two
quota-truncated runs — v1's in-run fixer lost a completed round's findings
when it died, and v1's original convergence check once mistook 4 failed
reviewers for a clean round):

1. Edit `docs/xtrace-hackathon-tasks.md`.
2. Run ONE review round (4 reviewer agents on Sonnet, ~one quarter of the
   old per-round cost):

   ```
   Workflow({ scriptPath: "scripts/xtrace-task-review.workflow.js",
              args: { taskDocPath: "docs/xtrace-hackathon-tasks.md" } })
   ```

   Returns `{ cleanRound, findings, failedLenses }`. If reviewers fail
   (quota), their completed peers' findings are still in the return value /
   task output on disk — nothing is lost.
3. BEFORE applying anything: append the round's raw findings verbatim to
   this log under a "### Round N — PENDING" heading, commit, push. This
   makes the findings durable even if the fixing session dies mid-apply
   (the workflow task-output file also holds them, but that lives outside
   the repo).
4. The MAIN SESSION (not an agent) verifies each finding against the repo,
   applies the valid ones to the task doc, and rewrites the PENDING entry
   as the final round entry (applied/rejected with reasons).
5. Commit and push the task doc + this log IMMEDIATELY — before launching
   the next round:

   ```
   git add docs/xtrace-hackathon-tasks.md docs/xtrace-hackathon-review-log.md
   git commit -m "xtrace tasks: review round N (<x> applied)"
   git push -u origin claude/xtrace-integration-brainstorm-t1chgj
   ```
6. Repeat 2–5 until a round returns `cleanRound: true` (all 4 lenses ran
   AND zero findings — `failedLenses > 0` never counts as clean). Then set
   Status above to "CONVERGED" with the date, commit, push.

## How to resume after an interruption

- `git pull origin claude/xtrace-integration-brainstorm-t1chgj`, read the
  Status line above and the last entry under Round history.
- If Status says a round is mid-flight or the last workflow run didn't
  converge, just re-run the Workflow command from step 2 — rounds are
  stateless (each round re-reads the doc from disk), so nothing is lost by
  restarting the loop.
- If the task doc itself is mid-draft (Status: "draft in progress"), finish
  the draft first, then start the loop.

## Round history

### Round 5 — 2 applied, 0 rejected

All 4 lenses ran (2 empty). Applied: [major] PII scrub on ingested post
bodies — T2 gains `redact.ts` (`scrubPii`: email-like + phone-like →
`[redacted]`, deliberately crude), T5 applies it to every post body before
ingest, and a seeded-email/phone AC replaces the synthetic-only assertion
that could never prove the scrub exists (ground rule 6 was otherwise
unenforced on the one free-form-text path leaving the app); [minor]
critical-path prose de-ambiguated — T5 is a demo prerequisite, not a code
dependency of T6. Raw findings below (PENDING-committed pre-application):

```json
[
 {
  "task_id": "XH-T5",
  "severity": "major",
  "claim": "One ingest per post: userId = author profileId, convId = pairingConvId(...), groupIds = [pairingGroupId(...)], message = the post body with an attribution prefix (\"{handle} said in the rivalry thread: \u2026\")",
  "problem": "Ground rule 6 explicitly forbids sending emails/tokens/secrets to xTrace or the Claude API, and XH-T5's own 'Never query or send' bullet repeats 'emails' as forbidden \u2014 but the post-ingestion path sends the raw, unfiltered post body verbatim (only an attribution prefix is added). Post bodies are free-form user-typed text (the existing moderation model in receipts-design-doc.md \u00a714/\u00a715.4 is reactive admin removal after the fact, not a pre-send filter), so a user who types an email address, phone number, or other PII into a rivalry-thread post has that content shipped to the third-party xTrace service with no redaction step anywhere in T2 (client), T5 (ingestion), or T1 (schemas). This is a straightforward, likely-to-occur path (unlike the pick-leakage question the doc does address in \u00a79.3) that violates the doc's own stated invariant. The acceptance-criteria test ('assert no @/email-like strings') only checks synthetic factory-seeded post bodies, which by construction won't contain emails, so it cannot catch this gap \u2014 it would pass even with zero redaction logic, giving false confidence that ground rule 6 is enforced.",
  "suggested_fix": "Add an explicit redaction/scrub step (e.g. strip email-like and phone-like patterns, similar in spirit to the money-word filter but applied to ingest INPUT rather than generation output) run on post bodies before they are sent via xtrace.ingest, and add a test that seeds a post body containing a real email/phone string and asserts the captured ingest payload does not contain it verbatim."
 },
 {
  "severity": "minor",
  "task_id": "doc",
  "claim": "Demo-critical path: T1 \u2192 T2 \u2192 T3 (T4 in parallel after T1) \u2192 T5 \u2192 T6. T7 is independently shippable once T2, T3, and T4 have merged; T8 additionally needs T6 (it reuses `companionCopy.disclaimer`).",
  "problem": "This sentence inserts T5 into the chain immediately before T6, implying T6 depends on (or must follow) T5. But the dependency table lists XH-T6's dependencies as 'XH-T2, XH-T3, XH-T4' only \u2014 T5 is absent. The rest of the same sentence tracks the table exactly (T7: T2/T3/T4; T8: adds T6), which makes the T5\u2192T6 insertion read as a real drafting slip rather than a deliberate 'demo readiness vs. code dependency' distinction (nothing in the doc says the two orderings differ intentionally). A reader using this prose to sequence work (rather than `workstream-lock.mjs list-ready`, which presumably reflects the table) could wrongly block T6 on T5's merge, or conversely assume T5 must ship first when nothing in T6's implementation actually requires it (the banter route's memory search is fail-open and works correctly with zero ingested memories).",
  "suggested_fix": "Either drop 'T5' from the critical-path arrow chain (`T1 \u2192 T2 \u2192 T3 (T4 in parallel after T1) \u2192 T6`) if T6 truly has no dependency on T5, or add a clarifying clause, e.g.: '...\u2192 T3 (T4 in parallel after T1) \u2192 T6 (T5 should run at least once beforehand for the demo to show grounded memory, but is not a code dependency of T6) \u2192 ...'."
 }
]
```

### Round 4 — 3 applied, 0 rejected

All 4 lenses ran (2 returned zero findings — converging). Applied: [major]
MONEY_WORD_REGEX_SOURCE broadened to catch morphological variants
(betting/bets/wagering/staked — the \b-anchored bare tokens never matched
them; runtime filter is now a strict superset of the copy-test literal,
with T3 AC cases added); [minor] T5's 200-source cap pinned as a single
shared budget (verdicts first, then posts) with a seeding AC; [minor]
T4's latestRecapForProfile reordered by seasons.ends_on DESC instead of
createdAt (regenerating an older season's recap can no longer shadow the
newest season on /you). Raw findings below (PENDING-committed
pre-application):

```json
[
 {
  "task_id": "XH-T5",
  "severity": "minor",
  "claim": "Batch cap per run: 200 sources (constant local to the job file), so a backlog never makes the job long-running.",
  "problem": "The spec never states whether the 200-source cap is a single shared budget across both source queries (concluded-pairing verdicts and pairing thread posts combined) or a separate 200-item cap applied to each query independently. A junior implementing this has two structurally different ways to write the candidate-selection SQL/loop (one combined counter vs. two independent `LIMIT`s), and the acceptance criteria never exercise this constant at all \u2014 only the circuit breaker (5 consecutive failures) and idempotency are tested, so a wrong or inconsistent interpretation of the cap would ship untested and undetected.",
  "failure_scenario": "A backlog of 150 uningested pairing verdicts and 150 uningested posts exists. Implementation A (combined cap) processes 200 total sources per run (e.g. 150 verdicts + 50 posts), leaving posts backlogged indefinitely relative to verdicts; Implementation B (per-query cap) processes up to 200 verdicts AND up to 200 posts (400 total) in one run, roughly doubling the intended per-run work bound the surrounding prose (\"so a backlog never makes the job long-running\") was meant to guarantee. Neither implementation is wrong per the letter of the spec, but they diverge in run time and in which sources get priority, and nothing in the acceptance criteria would catch the discrepancy.",
  "suggested_fix": "State explicitly, e.g.: \"MAX_SOURCES_PER_RUN = 200 is a single shared budget for the run: select uningested pairing-verdict candidates first (up to 200), then fill any remaining budget with uningested post candidates, so the two source types combined never exceed 200 per run.\" Add an acceptance-criteria bullet asserting this (e.g. seed 150 uningested verdicts + 150 uningested posts, run once, assert total ingest attempts \u2264 200)."
 },
 {
  "severity": "major",
  "task_id": "XH-T1",
  "claim": "MONEY_WORD_REGEX_SOURCE = '\\\\bbet\\\\b|\\\\bstake\\\\b|\\\\bwager\\\\b|\\\\$' \u2014 pinned as THE runtime filter satisfying ground rule 5 / INV-8 (\"All generated text passes a runtime filter for /\\bbet\\b|\\bstake\\b|\\bwager\\b|\\$/i before storage or render. A line that fails is dropped\").",
  "problem": "The \\b word-boundary anchors only match the exact bare tokens 'bet', 'stake', 'wager'. Because \\b requires a transition between a word char and a non-word char, none of the common morphological variants are caught: 'betting', 'bets', 'wagering', 'wagers', 'staked' all fail to match (e.g. 'betting' contains 'bet' immediately followed by 't', a word-word transition, so \\bbet\\b never fires). Since generation prompts explicitly forbid these concepts but the LLM is not constrained to exact tokens, a plausible completion like 'no more betting against you this season' or 'she's still wagering on a rematch' would pass filterLines() untouched and get stored/rendered, directly undermining the invariant this filter exists to enforce. This is being freshly pinned as an exported core constant for this feature (XH-T1), so it is in scope for this task even though the doc notes the literal is mirrored from an existing test file.",
  "suggested_fix": "Broaden the regex to catch common variants, e.g. MONEY_WORD_REGEX_SOURCE = '\\\\bbet(s|ting|ted)?\\\\b|\\\\bstak(e|es|ed|ing)\\\\b|\\\\bwager(s|ing|ed)?\\\\b|\\\\$' (or drop the trailing \\b and match on the stem plus optional suffix chars), and add filter unit-test cases in XH-T3's acceptance criteria for 'betting'/'wagering'/'bets' specifically, not just the bare words and '$50'."
 },
 {
  "severity": "minor",
  "task_id": "XH-T4",
  "claim": "latestRecapForProfile(db, profileId): Promise<CompanionArtifactRow | null> \u2014 the row with kind = 'season_recap' and the greatest createdAt for that profile, or null.",
  "problem": "Recap cache keys are scoped per season (recap:{seasonId}:{profileId}), so a profile can accumulate recap rows for multiple past seasons over time. Selecting purely by max(createdAt) picks whichever recap was most recently *generated*, not the recap for the most recently *ended* season. If an operator (or a future demo/ops re-run) generates or regenerates a recap for an older season after a newer season's recap already exists \u2014 which XH-T9's runbook explicitly supports via the given-seasonId path that skips the ended-season check \u2014 /you would silently show the older season's recap instead of the latest one, with no error surface (fail-open masks it).",
  "suggested_fix": "Either join through `seasons` and order by `seasons.endsOn` (or `startsOn`) descending rather than `companion_artifacts.createdAt`, or have latestRecapForProfile take an explicit seasonId (mirroring how the job resolves 'latest ended season') so the /you page always requests the correct season's recap rather than trusting insertion order."
 }
]
```

### Round 3 (final panel) — 8 applied, 0 rejected

All 4 Sonnet lenses completed (0 failures); 8 findings, all verified valid
and applied by the main session. This round vindicated the strict close:
it caught 4 majors the main-session pass had missed — (1) T3's
generation-time zod schemas lacked the per-string 280-char bounds T1's
response schemas enforce, so an over-long stored line would silently blank
the surface at parse time (fixed: identical inner bounds, with the
SDK's client-side-validation behavior documented); (2) T6's island spec
suggested bare `request()`, which THROWS on 500/parse failure rather than
returning the render-nothing value — a try/catch wrapper is now required
and the tests target the wrapper; (3) T5's outage circuit breaker — the
load-bearing safety mechanism — had zero acceptance criteria (added:
exactly-5-consecutive-calls abort, counter reset on success, TEST_CLOCK-
driven deadline abort between individual calls); (4) T4's pinned
`content` jsonb had no slot for callout drafts, leaving T7 with no key to
write (added `drafts?: string[]`; T7 step 9 pins it). Plus one more
major — T1's `getRecapResponseSchema` had no consumer anywhere (deleted,
with a NOTE explaining the absence) — and 3 minors (wrong cap constant
cited for the grudge-book fold: `NEMESIS_HISTORY_DEFAULT_LIMIT` 20, not
`PAGINATION_MAX_LIMIT` 50; `.env.example` header quoted inexactly;
`filterLines` scalar-title usage clarified).

Raw findings JSON preserved verbatim below (committed pre-application at
e50282c per protocol v2.1 step 3):

```json
[
 {
  "task_id": "XH-T6",
  "claim": "Do NOT fold `getNemesisHistoryPage` the way the grudge book does \u2014 that fold reads one page capped at `PAGINATION_MAX_LIMIT`, silently truncating \"lifetime\" for long histories.",
  "problem": "Repo reality: the grudge book's actual call in `apps/web/app/rivals/page.tsx` is `getNemesisHistoryPage(db, profile.id, { limit: NEMESIS_HISTORY_DEFAULT_LIMIT })` (line ~127), and `NEMESIS_HISTORY_DEFAULT_LIMIT = 20` (`apps/web/lib/nemesis/service.ts:182`) \u2014 not `PAGINATION_MAX_LIMIT` (50, `packages/core/src/config.ts:302`). The grudge-book fold is capped at 20, not 50. The guidance itself (don't reimplement this fold; use the untruncated `lifetimeRecordBetween`/`completedPairingIdsBetween` aggregates instead) is still correct, but the cited cap is factually wrong, which could mislead an implementer cross-checking the reasoning against the code (e.g. when writing a test comment or explaining the trap in a PR).",
  "severity": "minor",
  "suggested_fix": "Change the cited constant to `NEMESIS_HISTORY_DEFAULT_LIMIT` (20), e.g.: \"that fold reads one page capped at `NEMESIS_HISTORY_DEFAULT_LIMIT` (20), silently truncating \\\"lifetime\\\" for long histories.\""
 },
 {
  "task_id": "XH-T1",
  "claim": "`.env.example` \u2014 under `# --- Feature flags ---` add `FLAG_COMPANION`, `FLAG_CALLOUT_DRAFT`, `FLAG_SEASON_WRAPPED`.",
  "problem": "The actual section header in `.env.example` (line 68) is `# --- Feature flags (\u00a74.6): FLAG_<NAME>=true to enable; defaults in packages/core/src/flags.ts ---`, not the bare `# --- Feature flags ---` quoted in the task. It's the only feature-flags section so an implementer will still find it, but the literal string given doesn't exist in the file.",
  "severity": "minor",
  "suggested_fix": "Quote the actual header: \"under the `# --- Feature flags (\u00a74.6) ---` section\" (or just say \"under the existing Feature flags section\") instead of the exact-but-wrong string."
 },
 {
  "task_id": "XH-T3",
  "claim": "Use structured outputs: ... `z.object({ lines: z.array(z.string()).min(1).max(COMPANION_BANTER_MAX_LINES) })` for banter, the same shape with `.max(COMPANION_DRAFT_MAX)` for callout drafts",
  "problem": "T1's `getBanterResponseSchema` and `draftCalloutResponseSchema` (packages/core/src/schemas/companion.ts) require each line/draft string to be `.min(1).max(280)`, but the `zodOutputFormat` schemas T3 feeds to `client.messages.parse` for banter and callout drafts only bound array length, not per-string length (only the recap path reuses core's `seasonRecapContentSchema` verbatim, which does carry the 120/600-char field caps). A junior implementing exactly what's written will let Claude return a line/draft longer than 280 chars; nothing in T2/T3's post-processing (`filterLines` only strips money-words/empties, doesn't truncate or reject by length) catches this before the artifact is stored. T6's client island then parses the stored `lines` against `getBanterResponseSchema` (280-char cap) and \u2014 per its own render-nothing rule for parse failure \u2014 silently blanks the panel; T7's button similarly parses `draftCalloutResponseSchema` against drafts that were never validated at generation time. There's no acceptance-criteria test anywhere in T3/T6/T7 that would catch a >280-char line, since the happy-path tests use short fixture strings.",
  "severity": "major",
  "suggested_fix": "In XH-T3, either (a) import and reuse T1's `getBanterResponseSchema`'s inner line schema / `draftCalloutResponseSchema`'s inner schema shape directly (i.e. `z.object({ lines: z.array(z.string().min(1).max(280)).min(1).max(COMPANION_BANTER_MAX_LINES) })`) so generation-time and client-parse-time bounds are the same object, or (b) explicitly add a truncate-to-280-chars step in post-processing alongside `filterLines`, and state that in the Spec bullet list so it isn't left to guesswork."
 },
 {
  "task_id": "XH-T6",
  "claim": "extract the island's fetch \u2192 envelope-unwrap \u2192 parse step into a plain exported function (or just use `request()` from `lib/pick-client.ts`) and unit-test THAT with a stubbed `global.fetch` ... assert `{ data: { banter: null } }`, 500, and parse failure all yield the render-nothing value.",
  "problem": "`request()` (apps/web/lib/pick-client.ts:66-110) does not return a sentinel on failure \u2014 it *throws* `ApiClientError` for a non-2xx status, a JSON-parse failure, a network error, and a schema-validation failure (only the `{ data: { banter: null } }` case returns a value, since that's a successful 200 whose payload happens to be `null`). The doc's own framing \u2014 'assert ... 500, and parse failure all yield the render-nothing value' \u2014 describes return-value semantics that `request()` does not have for those two cases; used as literally suggested ('just use request()'), the island's effect would need to catch a thrown `ApiClientError` and map it to `null`, but the doc never states that a try/catch wrapper is required, so a junior following 'just use request()' will write code that throws on 500/parse-failure instead of rendering nothing, and their unit test (which expects a returned render-nothing value) will fail against an uncaught rejection instead.",
  "severity": "major",
  "suggested_fix": "Add an explicit line: 'wrap the `request()` call in try/catch inside the extracted function \u2014 any thrown `ApiClientError` (network, non-2xx, parse failure) maps to the same render-nothing return value as a successful `{banter: null}` response' and adjust the acceptance criteria to test the wrapper function, not `request()` directly, since `request()` alone cannot satisfy the 'yields render-nothing' assertions for the 500 and parse-failure cases."
 },
 {
  "task_id": "XH-T3",
  "claim": "Post-processing: run `filterLines` on every string field; for recaps a filtered-out paragraph drops that paragraph, and a result with zero surviving paragraphs (or a filtered title) \u2192 `null`.",
  "problem": "`filterLines` (packages/companion/src/filter.ts) is typed as `(lines: string[]) => string[]` \u2014 an array-in, array-out function. Applying it to a single scalar field like the recap `title` isn't shown: does the junior call `filterLines([title])[0]`, check `.length === 0` to detect a dropped title, or write a separate scalar helper? The doc says 'run filterLines on every string field' as if the function directly accepts a scalar, which it doesn't per its own declared signature.",
  "severity": "minor",
  "suggested_fix": "Add one line clarifying the scalar case, e.g. 'for scalar fields (recap title) call `filterLines([value])`; an empty result means the field was filtered out and (per the rule above) the whole recap becomes null.'"
 },
 {
  "task_id": "XH-T5",
  "claim": "Batch cap per run: 200 sources... So also circuit-break on outage: abort the run after 5 consecutive ingest() failures... or once the run exceeds a 5-minute wall-clock deadline from at... record the abort in the report (aborted: true).",
  "problem": "This circuit breaker is the mechanism that specifically prevents the failure mode the spec itself calls out: an xTrace outage burning ~10s per retried call \u00d7 up to 400 calls (200 sources \u00d7 2) = up to an hour of sequential failures, blowing past pg-boss's job expiration and triggering concurrent re-delivery of the same job (a real at-least-once hazard, worsening load during an incident). Despite being the load-bearing safety mechanism for exactly the race/pile-up scenario this review is meant to catch, none of the listed acceptance criteria exercise it: the integration test only covers the happy path (2 ingests, idempotent re-run) and 'fake client returning false \u2192 nothing marked'. There is no test asserting the run actually stops after 5 consecutive failures, stops at the 5-minute deadline, or sets aborted:true on the report. A wrong comparison operator (>= vs >), a counter that fails to reset after an intervening success, or a deadline check applied at the wrong granularity (e.g. only checked between pairings, not between the per-side ingest calls within one pairing) would all pass every currently-specified test while leaving the job able to run for the full hour it was designed to avoid.",
  "severity": "major",
  "suggested_fix": "Add to XH-T5's acceptance criteria: an integration test with a fake XtraceClient that always returns false, asserting the run stops after exactly 5 ingest() calls (not 5 pairings/sources) and the report has aborted:true; and a test using TEST_CLOCK/a controllable `at` plus a fake client with artificial per-call delay (or a fake clock check) asserting the run aborts once elapsed time from `at` exceeds 5 minutes, before exhausting the full candidate batch. Also assert unprocessed sources are not marked ingested so the next run naturally retries them."
 },
 {
  "task_id": "XH-T1",
  "severity": "major",
  "claim": "`export const getRecapResponseSchema = z.object({ recap: seasonRecapContentSchema.extend({ generated_at: zTimestamp }).nullable() });` \u2014 listed under the rule \"define ONLY what a task consumes ... every export below has a named consumer in T3/T6/T7/T8\"",
  "problem": "No task ever imports or parses `getRecapResponseSchema`. XH-T8's `/you` panel is explicitly server-rendered straight from the DB row returned by `latestRecapForProfile` (\"No client island needed ... render server-side\") \u2014 there is no GET recap API route anywhere in T6-T9, so nothing ever produces a `{ recap: ... }` envelope that this schema would validate. Contrast with `getBanterResponseSchema`, which T6's route and client island both explicitly parse. This contradicts the doc's own stated invariant for this section and would leave a junior engineer either building an unneeded/unspecified recap API route to give the schema a consumer, or shipping a dead export with no test rationale beyond \"parses valid/invalid payloads\" in isolation.",
  "suggested_fix": "Either delete `getRecapResponseSchema` from XH-T1 (keep only `seasonRecapContentSchema`, which `SeasonRecapContent` and T3/T8 do need), or, if a future/parallel GET recap route is intended, add it explicitly to T8's file list and route spec so the schema has a real consumer."
 },
 {
  "task_id": "XH-T4 / XH-T7",
  "severity": "major",
  "claim": "T4 pins `companion_artifacts.content jsonb` as `{ lines?: string[], recap?: {title, paragraphs}, model: string, promptVersion: number }`, and T7 step 9 says only \"Store artifact, return `draftCalloutResponseSchema` shape\" without naming which content field holds the generated drafts.",
  "problem": "The pinned content shape has a slot for banter (`lines`) and for recap (`recap`), but none named for callout drafts. T7 doesn't own any `packages/db` files (T4 does), so T7 can't add a `drafts?` field to the pinned shape itself, yet it must store an array of up to `COMPANION_DRAFT_MAX` draft strings somewhere in `content`. A junior implementing T7 has no pinned field to write to \u2014 they'd either reuse `lines` (undocumented, and semantically confusable with banter lines when debugging/inspecting rows) or invent a `drafts` field that contradicts T4's already-shipped pinned shape, which is exactly the kind of literal/shape drift the rest of the doc goes out of its way to prevent (cf. the cache-key-builder rule one section later).",
  "suggested_fix": "In T4's content shape, add an explicit `drafts?: string[]` field (or clarify that callout drafts are stored under the existing `lines` field), and have T7 step 9 explicitly say `content: { lines: drafts, model, promptVersion }` (or `{ drafts, model, promptVersion }`, matching whichever T4 picks) so both tasks agree on the exact key."
 }
]
```

### Round 2 (resumed run) — 8 applied, 0 rejected — split fixer

12 raw findings from 4 reviewers deduped to 8 unique. The in-run fixer
died on quota mid-application; the main session recovered the findings
from the workflow journal and finished the job (this event motivated
protocol v2 above). Applied by the fixer before it died: T6 step 0
`enforceGetBackstop` (the route would have shipped as the only backstop-less
`/api/v1` GET); T6 cache-lookup-before-rate-limit reorder with rationale;
`enforceRateLimit` returns-not-throws form pinned; T2 retry policy widened
to 429/5xx/network-timeouts (matching the venues template and T5's outage
arithmetic) with a timeout-retry AC. Applied by the main session from the
journal: T7 gate ladder rewritten (explicit steps 1–6: same
cache-before-limit order; target authorization via untruncated
`completedPairingIdsBetween` OR current candidates — the page-capped
history check would falsely 403 rivals older than 20 entries); T6 + T7 ACs
now pin that a cache hit does not consume the rate budget (demo-killer:
30 `/rivals` opens in a day would 429 and silently hide the panel);
T8 `calloutsSent` season window pinned to ET-calendar-day comparison (the
naive timestamptz-vs-DATE compare silently drops the season's final day);
T9 seed must set `status`/`scoreA`/`scoreB`/`edgeA`/`edgeB`/
`winnerProfileId` columns alongside the verdict jsonb (aggregates read
columns, not jsonb — jsonb-only seeding demos as 0-0-3 all-draws).

### Round 1 (resumed run) — 22 applied, 0 rejected

(Resumed run of 2026-07-23, after the quota-aborted round below; the loop's
round counter restarted. 26 raw findings from 4 reviewers deduped to 22
unique; every repo fact re-verified before editing; none rejected.)

- APPLIED [blocker] XH-T5/XH-T8: widened owner regex corrected to `/^(WS\d+|XH)-T\d+$/` — the previously pinned `/^(WS|XH)\d+-T\d+$/` still rejected the digit-less `XH-T5`/`XH-T8` owners (×3 dup findings merged)
- APPLIED [major] XH-T6: MEMORY search now ORs group ids of ALL pairings between the two profiles (current + completed, via T4's `completedPairingIdsBetween`) instead of only the current pairing's group — rematches are new pairing ids, so the old scoping silently missed every concluded week's memories; AC added asserting the captured `groupIds` (×2 dup findings merged)
- APPLIED [major] XH-T6: island-test AC rewritten to repo reality — no jsdom/@testing-library exists and web vitest pins `environment: 'node'`; fetch→envelope-unwrap→parse is extracted and unit-tested with stubbed `global.fetch`, presentational states via `renderToStaticMarkup`; adding jsdom declared out of scope
- APPLIED [major] XH-T6: `currentWeek` pinned — non-null only when `pairing.status === 'active'`, other statuses serve `currentWeek: null` (no 404); `daysRemaining` = ET days from `etDateString(now())` through `addDaysToDateString(weekStart, 6)`, clamped ≥ 0
- APPLIED [major] XH-T6: money-word AC de-contradicted — the test builds the real generator via `createGenerator` over a fake Anthropic-shaped client (the route does not re-filter, so doubling the Generator itself would bypass the filter the test exists to prove)
- APPLIED [major] XH-T4: `markIngested` contract rewritten to T5's mark-AFTER-successful-ingest protocol — the old claim-before-ingest comment would permanently lose facts on any ingest failure
- APPLIED [major] XH-T8: `stats` formulas pinned — season-scoped W-L-D bucketed by `winnerProfileId`; `bestStreak` = longest win run over completed pairings by `weekStart` (explicitly NOT `profiles.bestStreak`/`bestWinStreak`); `calloutsSent` by `createdAt` within `[startsOn, endsOn]`; `calloutsWon` via `pairingId` → completed pairing won by the profile
- APPLIED [major] XH-T9/XH-T8: demo recap flow unbroken — seed script now prints the season id, runbook invokes `run-season-recap.mjs <seasonId>`, and T8's given-id path explicitly skips the `endsOn < today` check
- APPLIED [minor] XH-T4: `etDay` pinned to `etDateString(now())` from `@receipts/core` (already exported from the root); dead conditional and `etCalendarDay` fallback removed
- APPLIED [minor] XH-T4: AC changed to `pnpm --filter @receipts/db db:check` — no root `db:check` alias exists
- APPLIED [minor] XH-T4: repository gains `lifetimeRecordBetween` + `completedPairingIdsBetween`, consumed by T6 and T7 — removes T7's dangling "same SQL aggregate as T6" reference (T7 doesn't depend on T6)
- APPLIED [minor] XH-T9: idempotency reworded — `seed-fixtures.mts` uses a sentinel early-exit, not upsert; both patterns allowed, early-exit named as the template's
- APPLIED [minor] XH-T2: venues template corrected — BOTH tsconfigs (`tsconfig.json` → base + noEmit, `tsconfig.build.json` → package), and no per-package eslint file (root `eslint.config.mjs` covers it)
- APPLIED [minor] XH-T2: `seasonConvId` annotated as reserved/unconsumed; "used by T5–T8" narrowed to the actual consumers (`pairingGroupId` T5/T6/T7, `pairingConvId` T5)
- APPLIED [minor] XH-T6/XH-T7: from-env instantiation + null-client behavior pinned — T6: null xtrace → MEMORY `[]`, null generator → `{banter:null}` 200; T7: null generator → `COMPANION_UNAVAILABLE`, null xtrace → MEMORY `[]` (×2 dup findings merged)
- APPLIED [minor] XH-T8: no-season-resolves path pinned — warn + zeroed report, `today` = `etDateString(now())`
- APPLIED [minor] XH-T7: draft button's callout-create POST pinned to `{}` body exactly like `CalloutButton` (optional `target_profile_id` stays unused; callout row identical to non-draft flow)
- APPLIED [minor] XH-T1: `contracts.test.ts` ERROR_CODES count pin (22 → 23) added to the errors.ts bullet, with the "editing the pin is expected" note
- APPLIED [minor] XH-T1/XH-T3: `COMPANION_DRAFT_MAX = 3` added to config; `draftCalloutResponseSchema` and T3's drafts output schema both use it (banter cap no longer doubles as the drafts cap)
- APPLIED [minor] XH-T1: dead contract surface dropped — `banterLineSchema` and `zCompanionArtifactId` removed (no task consumed either)
- APPLIED [minor] XH-T5/XH-T9: `apps/worker/scripts/run-companion-ingest.mjs` added to T5's Files list; runbook references it by path (the 04:00 cron alone can't drive a live demo)
- APPLIED [minor] XH-T9: seed verdict jsonb pinned to XH-T5's exact shape (per-profile `narration` map, both sides' lines populated) — wrong shapes degrade silently through T6/T8's optional chaining

### Round 2 — aborted, no coverage

All four reviewer lenses failed before reading the doc ("You've hit your
session limit · resets 9am (UTC)"). Zero findings were reported because zero
reviews ran; this round provides no evidence about doc quality. The workflow
script's convergence check has been fixed to abort (converged: false) when
lens agents fail with no findings, instead of declaring a clean round.

### Round 1 — 30 applied, 0 rejected

40 raw findings from 4 reviewers deduped to 30 unique findings; every repo
fact was re-verified before editing. No finding was wrong; the two claimed
duplicates that conflicted (T8 claimed-check: `profiles.kind = 'claimed'`
vs `user_id IS NOT NULL`) were resolved in favor of the repo's actual
precedent (`rivals/page.tsx` uses `profile.kind === 'claimed'`), and the
COMPANION_UNAVAILABLE placement conflict (T7 adds vs T1 adds) was resolved
to T1, the designated contract-change PR.

- APPLIED [blocker] XH-T6: route file moved to existing `[id]` segment (`pairings/[id]/banter/route.ts`); Next.js forbids a sibling `[pairingId]` slug — param read as `params.id` (×1)
- APPLIED [blocker] XH-T6: island spec now unwraps the §9.1 `{ data }` envelope before `getBanterResponseSchema.parse` (or reuses `request()` from `lib/pick-client.ts`); island-test AC pins the enveloped fetch-stub shape; same envelope note added to T7's button (`json.data.drafts`) (×4 dup findings merged)
- APPLIED [blocker] XH-T6: currentWeek scores must be derived from picks via `getFullPairingSharedQuestionPicks` + engine's `scoreNemesisWeek` — `scoreA/scoreB` are only written at conclusion by `updatePairingConclusion`, so the active row always reads 0–0
- APPLIED [major] XH-T5/XH-T8: added `apps/worker/test/registry.test.ts` edits to both Files lists — add jobs to `SPEC_JOBS` (T8 also `QUEUE_ONLY`) and widen owner regex to `/^(WS|XH)\d+-T\d+$/` (test currently rejects `XH-*` owners)
- APPLIED [major] XH-T1: added `RL_COMPANION_BANTER_PROFILE_D = 30` and `RL_CALLOUT_DRAFT_PROFILE_D = 10` to T1's config list; T6/T7 rate rules now pin `{ keyType: 'profile', limit: RL_*, windowSeconds: DAY }` and drop "suggested"
- APPLIED [major] XH-T5: documented the real verdict jsonb shape (`narration: { [profileId]: { line, emphasis } }`) with side-selection rules — T5 ingests each side's own line, T6 uses the viewer's line, T8 the profile's own lines (×2 dup findings merged)
- APPLIED [major] XH-T7: replaced the stream-of-consciousness MEMORY paragraph with a pinned procedure — all prior pairings, one user-scoped + one OR'd group-scoped search, group-first concat, de-dupe by id, truncate to `COMPANION_SEARCH_LIMIT`
- APPLIED [major] XH-T5: added outage circuit-breaker (5 consecutive failures or 5-minute wall-clock deadline, `aborted` in report) — the 200-source cap alone doesn't bound wall time under a down xTrace
- APPLIED [major] XH-T3: dependency changed to XH-T1 + XH-T2 (T3's files live in the package T2 scaffolds); T3 Files gains the barrel-extension bullet; critical-path prose updated
- APPLIED [major] XH-T8: dependency gains XH-T6 (`companionCopy.disclaimer` is created by T6); index table and critical-path prose updated
- APPLIED [minor] XH-T7: pinned `COMPANION_UNAVAILABLE: 503` — added to T1's `packages/core/src/errors.ts` list (T1 is the contract-change PR); T7 step 8 and AC rewritten, `PRICE_UNAVAILABLE` reuse forbidden (×4 dup findings merged)
- APPLIED [minor] XH-T3: TS-SDK error classes corrected in T3 + Appendix B — no `APIStatusError` in the TS SDK; `APIConnectionError` subclasses `APIError` and must be checked first; catch-all required (×2 dup findings merged)
- APPLIED [minor] XH-T6: `companionCopy` money-word coverage — copy.test.ts has no whole-file scan; task now adds its own per-block test case
- APPLIED [minor] XH-T2: scripts list corrected to `build`/`typecheck`/`test` — no per-package `lint` exists; root `pnpm lint` covers the package
- APPLIED [minor] XH-T8: claimed check pinned to `profiles.kind = 'claimed'` (rivals/page.tsx precedent); dead pointer to `lib/callouts-view.ts` removed (×2 dup findings merged, conflicting fixes resolved to repo precedent)
- APPLIED [minor] XH-T9: "three companion tables" → the two real tables (`companion_artifacts`, `companion_ingest_log`) (×3 dup findings merged)
- APPLIED [minor] XH-T9: "callout candidates state" seed item replaced — candidates are derived via `getCalloutCandidates`, nothing extra to seed; verify-both-directions note added
- APPLIED [minor] XH-T5: `at` parameter defined — defaults to `now()`, feeds ingest turn `date` and the wall-clock deadline, does not filter sources
- APPLIED [minor] XH-T6: `generated_at` pinned to the artifact row's `createdAt` `.toISOString()` on both cache hit and fresh insert (never `now()`); rule extended to T8's recap
- APPLIED [minor] XH-T4: `latestRecapForProfile` pinned to `kind = 'season_recap'` + greatest `createdAt` (kind filter load-bearing vs fresher banter artifacts)
- APPLIED [minor] XH-T8: worker script changed to `run-season-recap.mjs` mirroring `question-zero-drill/manual-schedule.mjs` (worker scripts are plain `.mjs`)
- APPLIED [minor] XH-T1: `export type SeasonRecapContent = z.infer<...>` added to T1's schema snippet; T3 signature comment now imports it from core (×2 dup findings merged)
- APPLIED [minor] doc: critical-path prose rewritten to match the dependency table (T2→T3 chain, T7 after T2/T3/T4, T8 also after T6, T9 after T5–T8)
- APPLIED [minor] XH-T2: `xtraceClientFromEnv` defaults `apiBase` to exported `XTRACE_DEFAULT_API_BASE = 'https://api.production.xtrace.ai'` when `XTRACE_API_BASE` unset
- APPLIED [minor] XH-T6: latency claim corrected to ~30s and XH-T3 client pinned to `maxRetries: 0` (SDK timeout is per attempt; retries doubled worst-case route latency)
- APPLIED [minor] XH-T8: note added that worst-case runs may exceed pg-boss job expiration and re-delivery is safe (step-1 skip + idempotent insert), not a bug
- APPLIED [minor] XH-T6: lifetime W-L-D switched from the page-capped `getNemesisHistoryPage` fold to a direct SQL aggregate over completed `nemesis_pairings` (fold truncates at `PAGINATION_MAX_LIMIT`); T7 references the same aggregate
- APPLIED [minor] XH-T5: "concluded or active" → `status` `'active'`/`'completed'` per `PAIRING_STATUS`, with explicit `scheduled`/`cancelled` exclusion
- APPLIED [minor] XH-T1: banter `max(3)` literals replaced with `COMPANION_BANTER_MAX_LINES` in T1's response schema and T3's `zodOutputFormat` schema
- APPLIED [minor] XH-T4: repository now exports `banterCacheKey`/`calloutDraftCacheKey`/`recapCacheKey` builders; T6/T7/T8 amended to call them instead of inline string formatting
