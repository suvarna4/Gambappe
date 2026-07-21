# Receipts

This repo implements `receipts-design-doc.md` (technical design, the buildable spec) from
`receipts-prd.md` (product intent) and `receipts-principles.md` (decision log). Start with
the design doc — it's intentionally over-specified so a task can be implemented from its
own listed sections plus §0–§5 shared context, without reading the whole thing.

The WS16–WS24 "journeys" work (the integrated app: mixed stack, settle-on-resolution,
rivals hub, Save/D-J8, shell) is spec'd in `docs/journeys-plan.md`. Its amendments have
landed in the canonical docs — PRD §4.1 and design-doc §6.7 (settle pipeline), §7.6, §10.1
(routes incl. `/sweat` `/rivals` `/crowd` `/you`), §10.3 (settled states), §10.6 (Save copy)
— so those sections already reflect the shipped app; read them as the record.

## Before starting implementation work

This repo is built by multiple parallel agents against the design doc's §19 work
breakdown structure. **Read `docs/workstream-locks.md` and use
`node scripts/workstream-lock.mjs list-ready` before claiming a task** — it's the
cross-agent lock that stops two agents from grabbing the same task, or one agent
starting work whose dependency hasn't actually merged. Claim before you branch; update
to `in_review`/`done` as your PR progresses; release if you stop.

Everything else about how to work a task — branch naming, one-task-per-PR, which spec
sections to read, `pnpm verify`, contract-change PRs for `packages/core` — is in the
design doc's §0 ("How to use this document") and §19.4 ("Cross-cutting rules").
