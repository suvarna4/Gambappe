# workstream-locks

This branch holds exactly one file, `workstream-locks.json` — the cross-agent task
lock registry for the Receipts §19 work breakdown structure. It has no history in
common with `main` on purpose (an orphan branch): it is operational state, not
product code, and is mutated by direct pushes from `scripts/workstream-lock.mjs`
(run from a checkout of `main`), never by hand.

Full usage instructions: `docs/workstream-locks.md` on `main`.
