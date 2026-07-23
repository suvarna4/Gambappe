# xTrace hackathon tasks — review log & process

Status: draft v1 complete, review loop not yet run.

This file is the durable state of the adversarial review process for
`docs/xtrace-hackathon-tasks.md`. It exists so the process can be resumed by
any future session (human or agent) after quota exhaustion or a dead
container: everything needed to continue lives on this branch
(`claude/xtrace-integration-brainstorm-t1chgj`), committed and pushed at every
checkpoint.

## Process (mandatory for every edit to the task doc)

1. Edit `docs/xtrace-hackathon-tasks.md`.
2. Run the adversarial review loop until it converges (a full round with zero
   accepted findings). In a Claude session:

   ```
   Workflow({ scriptPath: "scripts/xtrace-task-review.workflow.js",
              args: { taskDocPath: "docs/xtrace-hackathon-tasks.md",
                      logPath: "docs/xtrace-hackathon-review-log.md",
                      maxRounds: 4 } })
   ```

   The loop runs 4 reviewer lenses per round (repo-reality,
   junior-implementability, correctness/design, cross-task consistency) and
   one fixer agent that applies or rejects each finding and appends a round
   entry below. Cost: ~5 agents per round; historically 2–3 rounds to
   converge. If it returns `converged: false` (hit maxRounds), re-run it —
   the log below carries the state.
3. Commit and push the task doc + this log after the loop finishes (or after
   any partial progress worth keeping):

   ```
   git add docs/xtrace-hackathon-tasks.md docs/xtrace-hackathon-review-log.md
   git commit -m "xtrace tasks: review round(s) N..M"
   git push -u origin claude/xtrace-integration-brainstorm-t1chgj
   ```

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

(no rounds yet)
