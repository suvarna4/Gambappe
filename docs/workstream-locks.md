# Workstream locks — coordinating parallel agents on the §19 WBS

Multiple Claude agents (or humans) can work on different tasks from the design doc's
work breakdown structure (`receipts-design-doc.md` §19) at the same time. This document
is the usage guide for the tool that stops two agents from claiming — or shipping — the
same task at once.

**If you are an agent about to start implementation work on this repo, read this file
before picking a task.**

## The short version

```bash
# 1. See what you can start right now
node scripts/workstream-lock.mjs list-ready

# 2. Claim the one you're taking (fails loudly if someone beat you to it)
node scripts/workstream-lock.mjs claim WS1-T2 --owner "<your session/agent id>" --branch "feat/ws1-t2-kalshi-adapter"

# 3. Do the work on that branch, per design doc §0.2 (branch naming, task-only scope, etc.)

# 4. When you open a PR
node scripts/workstream-lock.mjs update WS1-T2 --status in_review --pr "<pr url>"

# 5. When it merges
node scripts/workstream-lock.mjs update WS1-T2 --status done

# If you have to stop before finishing (blocked, out of scope, whatever)
node scripts/workstream-lock.mjs release WS1-T2 --note "blocked on venue rate limits, see PR comment"
```

Run `node scripts/workstream-lock.mjs help` any time for the full command list.

## Why this exists

§19 of the design doc lays out ~80 tasks across 15 workstreams with an explicit
dependency graph and wave plan, precisely so multiple agents can build the product in
parallel. The one thing the doc can't do on paper is stop two agents from independently
grabbing the same task, or one agent starting a task whose dependency hasn't actually
merged yet. That's what this tool is for — a shared, git-backed registry of "who's doing
what," with the actual claim/release operations made safe under concurrency.

This tool coordinates **who is doing which task**. It does not replace anything in
§0.2/§19.4 of the design doc — branch naming, one-task-per-PR, reading the task's listed
spec sections, `pnpm verify`, contract-change PRs for `packages/core`, etc. all still
apply. Claiming a task here is the first step, not a substitute for the rest of the
workflow.

## Where the data lives

The registry is a single file, `workstream-locks.json`, on a dedicated **orphan branch**
called `workstream-locks` — it shares no history with `main` on purpose. It holds
operational state (who's claimed what), not product code, so it's mutated by direct
pushes from `scripts/workstream-lock.mjs`, never through a PR and never by hand-editing.

You will not see this branch or file in your normal working tree. The script manages it
in a throwaway `git worktree` on every invocation — you don't need to check it out,
switch to it, or merge it into your feature branch. Just run the script from anywhere
inside a checkout of this repo with `origin` reachable.

## How the concurrency guarantee actually works

There's no server, database, or file lock here — just git. Every mutating command
(`claim`, `update`, `release`, `add-task`, `remove-task`):

1. Fetches `origin/workstream-locks` fresh.
2. Reads the registry, applies your change to an in-memory copy, and checks business
   rules (is the task actually `available`? are its dependencies actually `done`?).
3. Commits and pushes straight to `workstream-locks`.

If another agent's push landed first, your push is rejected (non-fast-forward) — that's
git's atomic ref update doing the work of a compare-and-swap. The script detects the
rejection, re-fetches, resets to the new tip, and **re-runs the whole read → check →
commit cycle from scratch** against the current state (up to 8 attempts). So if the
other agent claimed the *same* task you wanted, your retry will correctly see
`status: claimed` and fail with a clear error instead of silently double-claiming it. If
they claimed a *different* task, your claim goes through on the next attempt with no
special handling needed on your part.

Net effect: two agents racing to claim the same task can never both win. You don't need
to do anything to get this guarantee — it's built into every command. You also don't
need to worry about corrupting the registry by running commands concurrently with other
agents; worst case you retry a few times.

## Task states

| Status | Meaning |
|---|---|
| `available` | Nobody's on it. Claimable if `ready` (see below). |
| `claimed` | Someone's actively working it. |
| `in_review` | PR is open (set this yourself when you open one). |
| `done` | Merged. Other tasks that depend on it become ready. |

`ready` isn't a stored field — it's computed from `depends_on` every time you run
`status` or `list-ready`, so it's never stale. A task's dependencies can be specific
task IDs (`"WS3-T2"`) or a whole workstream (`"WS0"`, meaning *every* task in WS0 must be
`done`) — exactly matching how the design doc's own "Depends" column reads.

## Mock-start tasks

Some tasks are marked `mock_start_ok: true` — these are the ones §19.2 explicitly calls
out as "Mock-start OK" (e.g. `WS7-T2` against `WS3-T2`). For these, `claim` **skips** the
dependency-readiness check, because the whole point is you can start coding against
`packages/core` contracts and mocks before the upstream task merges.

The tool still enforces the other half of that rule: `update <task> --status done` is
**always** gated on real dependency-readiness, mock-start or not. You can start early;
you cannot merge first. If you try, you'll get an error naming exactly which dependency
is still outstanding.

## Reading the `note` field

A handful of tasks have dependencies the design doc states as prose rather than a clean
task list — e.g. `WS14-T3`'s dependency is literally "most" (§1.2/§10.6 audit), and
`WS10-T1` has different dependencies at P0 vs P1. These are recorded as `depends_on: []`
(or a best-effort list) **plus a `note` explaining the caveat**. `status` and
`list-ready` both surface the note — read it before claiming anything that has one.
`depends_on: []` does not always mean "claimable in wave 1."

## Command reference

```
init [--seed <file>] [--force]
```
Bootstraps the `workstream-locks` branch. Already done for this repo — you should not
need this unless you're intentionally resetting the whole registry (`--force`, destroys
current state) or spinning up the same pattern in a different repo.

```
status [taskId] [--json]
```
No args: table of every task (id, status, phase, computed `ready`, owner, mock-start
flag, truncated note). With a task ID: full JSON for that one task, including `ready`.

```
list-ready [--phase P0] [--json]
```
The actual "what can I start right now" list: `status: available` and either
`mock_start_ok` or all dependencies `done`. Filter to a phase if you're only working P0.

```
claim <taskId> --owner <id> [--branch <name>]
```
Claims a task. Fails immediately (no point retrying) if it's not `available`, or if it's
not ready and not mock-start-eligible. `--owner` should be something that identifies
*you* to a human later — your git branch name, session id, or similar; there's no
enforced identity scheme, this is a cooperative tool between trusted agents, not an auth
boundary.

```
update <taskId> --status <available|claimed|in_review|done> [--branch <n>] [--pr <url>] [--note <text>] [--clear field1,field2]
```
Moves a task through its lifecycle. `--clear` nulls out fields (`note`, `pr`, `branch`,
`owner`) that flags can only ever set to a truthy value. Marking `done` is blocked if
dependencies aren't actually satisfied yet (see Mock-start above).

```
release <taskId> [--note <text>]
```
Returns a task to `available` and clears `owner`/`branch`/`pr`/`claimed_at`. Use this to
abandon work you started, or to unstick a claim that looks dead (see below) — there's no
ownership check, so anyone can release anyone's claim. Leave a `--note` explaining why
when it's not your own claim, so the next agent (and any human watching) has context.

```
add-task <taskId> --title <text> [--phase P0] [--depends a,b,c] [--mock-start-ok] [--note <text>]
remove-task <taskId>
```
For when the design doc grows a new workstream or task after this registry was seeded.
`remove-task` refuses if the task isn't `available` or if another task still lists it in
`depends_on` — release/re-point dependents first.

## Handling a stale claim

There's no automatic expiry. If a task has been `claimed` for a long time with no
corresponding branch activity or PR, and you (or a human) conclude it's abandoned:

```bash
node scripts/workstream-lock.mjs release WS3-T5 --note "no activity since <date>, releasing — see <link> if reviving"
```
Then it's claimable again. Prefer investigating (check the recorded `branch`/`pr` field
first) over reflexively releasing — someone might just be mid-task.

## Troubleshooting

- **"origin/workstream-locks already exists"** on `init` — expected; it's already
  bootstrapped. You don't need to run `init` again.
- **A command hangs or errors on `git worktree add`** — a previous invocation may have
  left a stale worktree registration (e.g. it was killed mid-run). Run
  `git worktree prune` yourself and retry; the script also runs this automatically at the
  start of every command.
- **`Gave up after 8 attempts`** — real contention (many agents claiming at once) or a
  network issue talking to `origin`. Just re-run the command.
