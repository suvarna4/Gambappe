// NOT a Node script. Workflow definition for Claude's Workflow tool.
//
// v2 — SINGLE-ROUND design (see docs/xtrace-hackathon-review-log.md for the
// full protocol). One invocation = one review round = 4 reviewer agents in
// parallel. Findings are RETURNED to the main session, which verifies and
// applies them itself, updates the review log, and commits + pushes BEFORE
// launching the next round. Rationale (learned the hard way, twice): the v1
// script looped rounds and delegated fixing to a 5th agent inside the run,
// so a quota exhaustion mid-loop either lost a whole round's findings (fixer
// died after reviewers succeeded) or produced a false "converged" result
// (reviewers died and zero findings looked like a clean round). In v2 the
// blast radius of a quota death is at most the current round's reviewers,
// findings always land in the durable task output, and there is a git
// checkpoint between every round by construction.
//
// Run with:
//   Workflow({ scriptPath: "scripts/xtrace-task-review.workflow.js",
//              args: { taskDocPath: "docs/xtrace-hackathon-tasks.md" } })
//
// Returns: { cleanRound, findings, failedLenses }
//   cleanRound === true  -> all 4 lenses ran and none found anything: converged.
//   cleanRound === false -> either findings to apply, or failedLenses > 0
//                           (a failed lens means NO convergence claim can be
//                           made this round, even with zero findings).
//
// Reviewers run on Sonnet: this is verification work (grep, read, compare),
// and the session's token budget is the binding constraint — two earlier
// runs died on quota with reviewers on the default (largest) model.

export const meta = {
  name: 'xtrace-task-review-round',
  description: 'ONE adversarial review round over the xTrace hackathon task doc: 4 lenses in parallel; findings returned to the main session for fixing and git checkpointing',
  phases: [
    { title: 'Review', detail: '4 parallel lenses: repo-reality, junior-implementability, correctness/design, cross-task consistency', model: 'sonnet' },
  ],
}

const REPO = '/home/user/Gambappe'
const taskDocPath = (args && args.taskDocPath) || 'docs/xtrace-hackathon-tasks.md'

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'task_id', 'claim', 'problem', 'suggested_fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          task_id: { type: 'string', description: 'e.g. XH-T3, or "doc" for doc-wide issues' },
          claim: { type: 'string', description: 'the exact statement/spec element in the doc that is wrong or ambiguous (quote it)' },
          problem: { type: 'string', description: 'why it is wrong, ambiguous, or would mislead a junior engineer — with evidence (file:line for repo-reality findings)' },
          suggested_fix: { type: 'string', description: 'the concrete replacement text or addition' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'repo-reality',
    prompt: `Lens: REPO REALITY. Verify every concrete reference in the task doc against the actual repo at ${REPO}: file paths, package names, table/column names, job names, flag names, env var names, API routes, schema/type names, section references (§N), workstream IDs. Use Read/Grep — do not trust the doc. Anything that does not exist must either be explicitly marked as NEW (to be created by that task) or is a finding. Also verify claimed repo conventions (test locations, migration commands, contract-change rules) match what the repo actually does.`,
  },
  {
    key: 'junior-implementability',
    prompt: `Lens: JUNIOR IMPLEMENTABILITY. Read each task as a junior engineer with no context beyond this doc and the repo. A finding is any point where they would have to guess or ask: missing function signatures, unspecified error behavior, ambiguous acceptance criteria (not mechanically checkable), undefined terms, steps that assume unstated knowledge, missing file paths for new code, unspecified data shapes, "handle errors appropriately"-style hand-waving. Acceptance criteria must be concrete enough that the junior knows exactly when they are done.`,
  },
  {
    key: 'correctness-design',
    prompt: `Lens: CORRECTNESS & DESIGN. Hunt for real defects in the specified design: race conditions, idempotency gaps (jobs are at-least-once pg-boss), missing DB constraints/indexes for the specified queries, cache-invalidation errors, N+1 or hot-path latency problems, LLM/xTrace calls that could block SSR or a job queue, missing timeouts/retries/fail-open behavior, secrets or PII in prompts/payloads, violations of the doc's own stated invariants (engine purity INV-5, §9.3 no pre-lock pick leakage, money-word filtering INV-8), migration mistakes, and test plans that would not catch the bugs the design could have. Also flag over-engineering: anything beyond what the tasks' stated hackathon scope needs.`,
  },
  {
    key: 'cross-task-consistency',
    prompt: `Lens: CROSS-TASK CONSISTENCY. Check the doc as a whole: dependency order is correct and acyclic; names (packages, tables, functions, env vars, flags, job names) are used identically across tasks; no two tasks own the same file or responsibility; no task consumes something no other task produces (respecting dependency order — a task may only rely on artifacts of tasks it depends on, directly or transitively); shared constants/types are defined in exactly one place; the pinned xTrace API appendix matches how every task uses the API; scope boundaries between tasks leave no gaps and no overlaps.`,
  },
]

const results = await parallel(LENSES.map((l) => () => agent(
  `You are an adversarial reviewer of an engineering task breakdown.

Read ${REPO}/${taskDocPath} in full first. The doc's own "Ground rules" and "xTrace API reference" sections are part of the spec — tasks must be consistent with them.

${l.prompt}

Report ONLY real findings — issues that would cause a wrong implementation, a blocked junior engineer, or a defect. Do not report stylistic preferences, restatements of intentional scope cuts the doc already declares, or hypothetical concerns the doc already addresses. This doc has already survived multiple review rounds: if it is clean under your lens, return an empty findings list — do not invent findings to seem useful. Severity: blocker = would produce wrong/broken code or an unimplementable task; major = a junior would stall or likely diverge; minor = small ambiguity with a likely-correct guess.

Your final output is raw data for the fixing step, not prose for a human.`,
  { label: l.key, phase: 'Review', schema: FINDINGS_SCHEMA, model: 'sonnet', effort: 'medium' }
)))

const failedLenses = results.filter((r) => !r).length
const findings = results.filter(Boolean).flatMap((r) => r.findings)
log(`${findings.length} findings, ${failedLenses}/4 lenses failed`)

return {
  cleanRound: failedLenses === 0 && findings.length === 0,
  findings,
  failedLenses,
}
