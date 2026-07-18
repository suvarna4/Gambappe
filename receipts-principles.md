# Receipts — Product Principles & Decision Log

**Purpose:** the PRD says what to build next; this doc says how to decide what to build after that. When a new idea, feature request, or pivot appears, test it against the principles and the hard lines. If it fails a principle, fix the idea or record a new decision that consciously amends the principle — never silently violate one.

---

## Principles

**P1. The app supplies the energy.**
Drama must come from structure — choice architecture, data narration, synchronized moments, ladders — never from asking users to perform emotion, humor, or ceremony.
*Test: if this feature shipped to a community of quiet strangers, would it still be dramatic?*

**P2. Everyone is a stakeholder; no neutral witnesses.**
Never design an audience role with nothing at stake. Dissolve spectators into participants: a viewer is always one tap from having a side.
*Test: what does the person watching lose or win?*

**P3. The loser is the protagonist.**
Loss content outperforms win content. Every mechanic's losing artifact gets equal or greater design investment than its winning artifact. Public failure, with style, is the brand.
*Test: is the losing screenshot the funnier one?*

**P4. Receipts over claims.**
Everything is timestamped and price-stamped at entry; nothing competitive is self-reported. Real markets are the only ground truth — we never invent odds or grade against our own opinions.
*Test: could a stranger verify this artifact without trusting us or the user?*

**P5. Works alone on day one.**
No feature may require arriving with friends. Strangers are supplied by matchmaking; community is an output, not a prerequisite. Friend-based play can exist, but only as an enhancement of a loop that already works solo.
*Test: is this fun for a user with zero contacts?*

**P6. One engine, many modes.**
The fingerprint/rating engine is the platform. Every new feature must read from it, write to it, or both. A feature that touches the engine compounds; one that doesn't is an island.
*Test: what does this feature teach the engine, and what does the engine give it?*

**P7. Obligations that outlive the moment.**
Every viral moment must deposit into a persistent structure — a streak, a record, a season, a rivalry history. Moments recruit; structures retain.
*Test: what remains on the profile a month later?*

**P8. Synchronize to concentrate.**
Shared fixed moments (one lock, one reveal, one assignment day) turn activity into spikes. Spikes trend; drips don't. Resist features that smear the ritual across the day.
*Test: does this add to the appointed moment or dilute it?*

**P9. Artifacts are doors, not dead ends.**
Every share card links to a live public page, and every live page offers one-tap participation without an account. Value accrues before identity; signup claims value rather than gating it.
*Test: what happens 10 seconds after a stranger taps the screenshot?*

**P10. Pressure the ego, never the wallet.**
All competitive and social pressure targets participation and pride — never stake size, never money. The app does not suggest, track, display, or celebrate real-money amounts. Small money, big dignity.
*Test: could a critic screenshot this feature as "the app pushed someone to bet more"? If yes, kill it.*

**P11. Plain language.**
No invented jargon. Mechanics are named in words a newcomer already knows (nemesis, duo, streak, house). If a feature needs a glossary, the feature is too complicated.
*Test: can someone explain it in one sentence after seeing it once?*

**P12. Fair fights, engineered drama.**
Matchmaking may maximize contrast in style, never in skill. Blowouts kill modes; the engine's job is to make every match feel winnable and every opponent feel like a story.
*Test: what's the expected win rate of the weaker side? (Keep it near 50%.)*

---

## Hard lines (not principles — laws)

- **We never hold money, route orders, set odds, take positions, or intermediate trades.** All real-money activity happens on regulated venues, on their surfaces, via outbound links. Anything that drifts toward brokering is a licensing regime we are not in.
- **We never collect credentials for other platforms.** No exchange API keys, no logins, no wallet private keys or transaction approvals. Read-only proof (e.g., wallet message signatures) is the ceiling.
- **In-app competition is never denominated in currency.** Points, ratings, streaks, records — no balances, no cash-equivalents, no purchasable advantage over other players.
- **Adults only.** 18+ attestation, no marketing in under-18-skewed channels, no content aimed at minors.
- **Public means public, stated plainly.** Records are public by design; users are told in one sentence at signup and can be pseudonymous forever.

## Decision log

- **D1 · Jul 17, 2026 — Build on Kalshi/Polymarket rails.** We are a social + data layer; the venues carry money, KYC, odds, and settlement. Rationale: legality, 48-hour feasibility, and honesty of the game (real prices as ground truth).
- **D2 · Jul 17, 2026 — Social mechanics over platform features.** The differentiated investment is losing together, opposing others, and matchmade rivalry — not betting infrastructure.
- **D3 · Jul 17, 2026 — Structure over sentiment.** Cut mechanics that rely on users performing emotion (mercy tribunals, eulogies-as-required-input). Replace with data narration, pre-commitment (sealed speeches), and ladders.
- **D4 · Jul 17, 2026 — Solo-first.** Serve users with no gambling friends via matchmaking and communal modes; friend-group features are enhancements, not the base.
- **D5 · Jul 17, 2026 — MVP = Daily Question + Assigned Nemesis + Duo Queue on one engine; Houses as stretch.** Houses are style-based permanent teams scored by aggregate member edge (not sides of markets), and ship only when sorting data is good.
- **D6 · Jul 17, 2026 — Guest-first funnel.** Ghost accounts, public spectator pages, claim-based signup. Matchmaking modes are the conversion reward.
- **D7 · Jul 17, 2026 — Profile linking: Polymarket signature-based read-only at V1; Kalshi deferred** (no consumer OAuth; API keys are trading-powered and off-limits). Pursue partner/referral conversations with both.
- **D8 · Jul 17, 2026 — No invented jargon** in mechanic names or copy.
- **D9 · Jul 17, 2026 — Related concept parked, not killed: the People's Parlay** (communal slip built by crowd vote, ride/fade split, saga counter). Strong candidate for a flagship communal mode post-V1; it passes P1–P9 and would plug into the engine via vote-weighting by rating.

*(Append new decisions with date + one-line rationale. If a decision amends a principle, say which and why.)*

## Lateral-development checklist

Run any new feature idea through these before speccing:

1. Fun for a user with zero friends? (P5)
2. Reads from or writes to the engine? (P6)
3. Mints an artifact where the loser is the protagonist? (P3, P4)
4. Artifact links to a live page with one-tap participation? (P9)
5. Adds to a synchronized ritual rather than diluting one? (P8)
6. Deposits into a persistent structure? (P7)
7. Pressures ego/participation only — never wallet? (P10, hard lines)
8. Nameable in plain words, explainable in one sentence? (P11)
9. Keeps fights fair while maximizing style contrast? (P12)
10. Stays entirely clear of money-handling, credentials, and odds-making? (hard lines)

A feature that clears all ten is on-thesis. A feature that fails one is a redesign. A feature that fails three is a different company.
