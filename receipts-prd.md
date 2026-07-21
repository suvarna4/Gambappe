# Receipts — Product Requirements Document

**Working title:** Receipts · **Version:** 0.1 · **Date:** July 17, 2026
**Scope:** MVP merges the Daily Question, Assigned Nemesis, and Duo Queue on a single fingerprint/rating engine. Houses (style-based factions) is an optional stretch goal.

---

## 1. Summary & thesis

Receipts is a social layer on top of regulated prediction markets (Kalshi, Polymarket). Users take timestamped, price-stamped positions on real markets and compete on prediction skill — against a daily crowd, an assigned nemesis, and a matched duo partner. The product's job is to manufacture the crowd, the stakes, and the drama itself, so a user who arrives alone on day one has a full social experience by day two.

Core thesis (from our principles doc):

- **The app supplies the energy.** Drama comes from choice architecture, data narration, and synchronized moments — never from asking users to perform emotion.
- **Everyone is a stakeholder.** There are no neutral witnesses; every viewer is one tap from being a participant.
- **Receipts over claims.** Every position is stamped with the live market price at entry. The share artifact is a verifiable record, not a meme.
- **Works alone.** No feature may require arriving with friends. Community is an output of matchmaking, not a prerequisite.

## 2. What we are and are not

- We are a game and data layer. **We never hold money, route orders, set odds, or take positions.** All prices and settlements come from regulated venues; all trading (if a user chooses to trade) happens on the venue, via outbound links.
- We never collect venue credentials. No Kalshi API keys, no wallet private keys, no exchange logins. (Details in §6–7.)
- In-app competition is scored in points/ratings, not currency. There are no deposits, balances, or payouts anywhere in the product.

This posture is both the legal position and the product position: dignity is the currency; the dollars stay on the venues.

## 3. Access model: guests, ghosts, and claiming

Non-logged-in users are first-class. The funnel is designed so value accrues *before* identity, and signup is framed as **claiming** what you've built, not registering.

**Ghost accounts (no signup).** Any visitor can answer the Daily Question in one tap. The app mints a device-scoped ghost identity (cookie/localStorage) with a generated handle ("Fox #4821"). Ghosts accumulate: a streak, a pick history, percentile results, and a forming fingerprint. Ghosts see reveals, leaderboards (as viewers), and all public pages.

**Spectator pages (no account, no cookie needed).** Every artifact — a daily reveal, a nemesis matchup, a duo ladder, a house standings page — is a public URL that renders fully without auth. Every share card links to its live page, and every live page has a one-tap "pick your side" that mints a ghost. **Share cards are doors, not screenshots.**

**Claiming (conversion moment).** Signup is email or OAuth (Google / X) or passkey — no phone, no KYC. The prompt is asset-framed and triggered by accrued value, e.g.:
- After a 3+ day streak: "Your ghost has a 3-day streak. Claim it before this device loses it."
- After 5 picks: "Your fingerprint is ready. Claim your record to get assigned your nemesis."

**What requires an account and why.** The Daily Question and all spectator surfaces are fully open. Nemesis assignment, Duo Queue, posting in threads, and House membership require an account — matchmaking needs persistent identity (a week-long nemesis match can't survive cookie churn), and this makes the social features the *reward* for claiming. The nemesis is the conversion carrot, not a paywall.

**Guest community access.** Reveal threads and matchup pages are readable by everyone; ghosts get limited reactions; posting requires a claimed account. This keeps the community visible from the outside (top of funnel) while keeping the writable surface accountable.

## 4. Core product

### 4.1 The Daily Question

One market per day. Everyone answers the same one. The morning drop is the appointment; results land when reality does.

> **Amended by the journeys plan (D-J3, `docs/journeys-plan.md` §5 WS23-T2).** The original
> "one synchronized reveal" is cut: settlement now follows reality. A question **settles the
> moment its venue market resolves — any time of day**, not on a shared 8pm clock. The daily
> appointment is the **morning drop** (a fresh market to answer); the app owns the _sweat_ (open
> positions) and the _artifact_ (the graded receipt), not a synchronized reveal moment.

- **Selection:** pulled from Kalshi/Polymarket catalogs by rule: settles within ~24–48h, liquidity above threshold, broad-appeal category, alternating category mix week over week. Curated by hand at launch; rules-assisted later.
- **Lock:** picks open at 9:00 local-region time and lock at a fixed deadline (e.g., 12:00 ET). The user sees the live market probability and takes a side; their **entry price is stamped** on the pick.
- **Settle (was Reveal):** a question settles when its venue market resolves — outcome, your result, the crowd split, your percentile, your streak all land then, whenever "then" is. Each settled pick is a graded receipt (win or obituary). The first settle of a profile's day is a per-settle push; a 21:00 ET digest summarizes the rest — no single synchronized moment.
- **Artifacts:** the share card carries side, entry price, result, streak, and a link/QR to the live question page. Longshot hits (entry ≤ 20%) mint a special "Called it" card.
- **Streaks and records:** daily streak, category records, lifetime accuracy and edge — all public on the profile.

### 4.2 Assigned Nemesis

Weekly, the engine assigns each claimed user a nemesis: a stranger at similar skill with a maximally opposite style.

- **Cadence:** assignments land Monday ("Meet your nemesis" reveal card). The match runs over that week's Daily Questions plus 2–3 bonus markets both are shown.
- **Scoring:** head-to-head on shared questions; ties broken by edge (performance vs. entry price). Week ends with a verdict card for both players.
- **Narration:** the app writes the story from data — streaks, comebacks, category dominance ("Maria has taken him down three straight weeks. Tonight is his last chance."). Notifications are narrative beats, not generic pings.
- **History:** lifetime record vs. each past nemesis; a "rematch" request is the only way to face the same person twice within a season.
- **Opt-outs:** nemesis participation is default-on for claimed users but can be paused; block/report removes a specific pairing permanently.

### 4.3 Duo Queue

Opt-in ranked 2v2. The engine pairs strangers with complementary fingerprints; duos climb a ladder against other duos.

- **Matches:** a match is a defined set (e.g., 6 shared markets over 3 days). Both partners pick independently; the duo score combines them. Best-of series at higher tiers.
- **Chemistry:** the duo page tracks joint accuracy vs. the expectation from the partners' individual ratings — a visible "synergy" stat ("You two hit 71% together — better than either of you alone").
- **Ladder:** tiers with promotion/relegation; weekly windows. Partners persist by mutual consent; either can re-queue solo.
- **Why strangers:** repeated pairing is how ranked duo queues in gaming turn strangers into friends — this is the sustained-community mechanism, by design.

### 4.4 Stretch: Houses (fixed design)

Houses are **permanent teams sorted by betting style, not sides of any market** — so every market feeds the ladder regardless of whether it has natural sides.

- **Sorting:** the fingerprint clusters users into four named houses (e.g., the chalk-riders, the contrarians, the longshot-chasers, the specialists). New users are sorted after placement (§5.6); ghosts see a "which house would you be?" teaser as a conversion hook.
- **Scoring:** house season score = aggregate member edge vs. entry price, with a per-member contribution cap so volume can't dominate skill. Monthly seasons; standings public.
- **Consensus flavor (big events only):** the house votes internally, majority becomes the official house call, and inter-house scoreboards light up for that event. The internal argument is content.
- **Ship rule:** Houses ships only after the engine has enough pick history to make sorting feel accurate; a badly sorted house is worse than no house.

## 5. The engine: fingerprints, ratings, matchmaking

Everything in §4 is a game mode on one engine. New features must read from or write to it (see principles doc, "one engine, many modes").

### 5.1 The fingerprint

A per-user vector rebuilt nightly from pick history:

- **Skill:** Brier score on resolved picks; **edge** = average return of picks measured against entry price and settlement (did you beat the price you paid attention at).
- **Chalk affinity:** mean implied probability of the sides taken (favorite-heavy ↔ longshot-heavy).
- **Contrarianism:** frequency of taking the minority side vs. the in-app crowd; direction relative to line movement where data allows.
- **Category profile:** volume and accuracy by category (sports, politics, econ, culture).
- **Timing:** early locker ↔ deadline locker.
- **Calibration:** if/when a confidence slider ships, an over/underconfidence curve.

### 5.2 Ratings

- **Global skill:** Glicko-2 (handles uncertainty for new users), updated from head-to-head results (nemesis weeks, duo matches), plus a percentile from daily accuracy for display.
- **Duo rating:** separate Glicko-2 team rating per duo.
- Ratings are public; the rating *inputs* (the raw pick log) are public too — this is receipts culture, stated plainly at signup (§7).

### 5.3 Nemesis matchmaking (weekly batch)

Pair to maximize drama while keeping matches fair:

1. **Band by rating** (Glicko rating ± uncertainty). Fair fights are non-negotiable; blowouts kill the mode.
2. Within band, **maximize style distance** (cosine distance on the style axes: chalk affinity, contrarianism, category profile).
3. **Require category overlap** above a floor so both will genuinely engage the week's markets.
4. Prefer compatible reveal timezones; forbid repeats within a season except mutual rematch.
5. Solve as weighted matching over the pool (greedy with swaps is fine at MVP scale).

### 5.4 Duo matchmaking (queue)

1. Band by rating.
2. **Maximize complementarity:** opposite chalk affinity and/or disjoint category strengths, so the duo's combined coverage beats either individual.
3. Seed the pairing with the predicted synergy; track realized synergy (chemistry) and feed it back as a matchmaking signal.
4. Duo-vs-duo opponents matched on team rating.

### 5.5 House sorting (stretch)

k-means (k=4) over the style axes, run at season boundaries; members are re-sorted only at season start (identity stability matters more than cluster purity mid-season).

### 5.6 Cold start

- **Placement:** 5-question placement flow on entry (past markets with known outcomes and known crowd splits) seeds a provisional fingerprint and a high-uncertainty rating.
- Nemesis eligibility after 5 real picks; duo eligibility after 10. Ghosts accumulate toward these thresholds, which strengthens the claim prompt.

### 5.7 Integrity

- Rate limits and device heuristics on ghost creation and picks (protects streak leaderboards and matchmaking pools from bots).
- One claimed account per person by policy; duplicate-account detection is best-effort, not paranoid (§7).
- Matches are scored only on markets served in-app, at in-app entry timestamps — externally placed trades never affect ratings (prevents claim-jumping and keeps grading verifiable).

## 6. Venue integration (Kalshi / Polymarket)

### 6.1 Market data & settlement (no auth required)

- **Kalshi:** public REST for catalog/prices; WebSocket for live updates during reveal windows; demo environment for development. Respect published rate-limit tiers; cache aggressively (spectator pages are served from our cache, never fan out to venue APIs).
- **Polymarket:** Gamma/CLOB APIs for catalog and prices; on-chain data as a secondary source.
- **Settlement:** graded from venue resolution feeds; manual override tooling for disputes/voids (voided markets void the day's question, streaks unaffected).
- **Entry-price stamping:** every pick stores the venue, market ID, side, timestamp, and live price at pick time — the atomic unit of the whole product.
- **Divergence flavor:** when both venues list the same event, show the spread as content on the question page.

### 6.2 Profile linking (optional, opt-in, read-only)

Purpose: enrich the fingerprint and give users a **verified track record** badge. Linking is never required and never unlocks anything competitive beyond skipping placement.

- **Polymarket — ship at MVP/V1.** Non-custodial by design: the user proves wallet ownership by signing a nonce message (Sign-In-With-Ethereum pattern). A signature proves control; it cannot move funds and exposes no keys. Their position history is already public on-chain; with proof of ownership we may read it to (a) seed a stronger initial fingerprint/rating and (b) show a "verified Polymarket record" badge. We ingest style and category signals and **bucket position sizes** — exact dollar amounts are never stored or displayed (§7).
- **Kalshi — deferred.** Kalshi has no consumer OAuth for third parties, and API keys carry trading power, so **we will never ask users for Kalshi API keys.** Posture: deferred until a partner/read-only path exists; action item — contact Kalshi bizdev about partner data access and referral links.
- Linked wallets display as a badge + derived stats by default; showing the address itself is a separate opt-in. Unlink at any time deletes the imported enrichment.

### 6.3 Outbound deep links

Every market page links out to the venue ("Trade this on Kalshi/Polymarket"), with referral parameters if programs are available (action item: apply to both). The link-out is the only path between our product and real money, and it always leaves our surface.

## 7. Privacy & security

Proportionate stance: this product handles no money and minimal PII, and its core loop is *public* records. Be transparent about publicness rather than building heavy privacy machinery, and be strict on the few things that matter.

**Hard rules**

- Never collect credentials for any other platform: no Kalshi API keys, no exchange logins, no wallet private keys or transaction approvals. Wallet linking = nonce signature only.
- No deposits, balances, or payment flows exist in the product; therefore no financial PII is ever collected.
- Minimal identity: email/OAuth/passkey. No phone numbers, no government ID, no KYC (that's the venues' job, on their surface).

**Public-by-default, stated plainly**

- Picks, records, ratings, and match history are public — that is the product. Signup copy says so in one sentence.
- Pseudonymous mode is first-class: a claimed account can keep a generated handle forever. Verified badges attach to the handle, not a legal name.
- Linked-wallet privacy: badge and derived stats by default; address display opt-in; position sizes bucketed, never exact.

**Sensible hygiene, not paranoia**

- Standard session security; secrets server-side only; spectator pages are static/cacheable and expose nothing user-specific.
- Ghost data is device-scoped and deletable by clearing the site; claiming migrates it; "delete my account" removes picks from public display and unlinks any wallet.
- Block/report in nemesis and duo contexts (the only places the app puts two strangers in a room); repeat-report auto-pauses a user's matchmaking pending review.
- 18+ attestation at claim time; no marketing on under-18-skewed channels. We handle no money, but the content is betting-adjacent — keep the audience adult.
- Pressure design rule (from principles): all competitive pressure targets participation and ego, never stake size. The app never suggests, tracks, or celebrates real-money amounts.

## 8. Design direction

"Simple but stylish" = one strong metaphor executed consistently: **the receipt/ticket.**

- Monospace numerals, stamp and perforation motifs, ticket-shaped cards; entry price rendered like a printed price.
- Dark default, one accent per side of a market — never rely on red/green alone (colorblind-safe pairs + iconography).
- Motion is spent on exactly one moment: the reveal. Everything else is fast and still.
- Mobile-first web; share cards designed at story and timeline aspect ratios; OG images so links unfurl as cards on X/Discord/Reddit/iMessage.

## 9. Distribution, sharing & virality

**Launch moment.** Launch keyed to a single flagship communal event, not a feature list — Question Zero at a major cultural moment (the World Cup final on Sunday is the immediate candidate: one question, one global reveal). One spectator URL is the campaign.

**Rituals concentrate output.** Fixed daily lock and reveal times; nemesis reveal every Monday. Synchronization turns social output into spikes, and spikes trend; drips don't.

**The share card is the growth engine.**
- Every card carries: side, entry price, result/live probability, streak, handle, and a link/QR to the live page.
- Every live page has one-tap side-picking for ghosts — the card recruits, the page converts.
- Losing artifacts get equal design investment: the busted streak card, the nemesis defeat card. **The loser is the protagonist** — loss content outperforms win content, and our brand is losing publicly with style.

**Creator wedge: the portable track record.** Public profile = a neutral, timestamped, price-stamped record page. Betting X is full of unverifiable touts; a link that proves your record is genuinely valuable, and every bettor who uses their Receipts profile as proof markets the product for free. Prioritize profile-page polish and unfurls accordingly.

**Channel plan.**
- X: run the official account as the narrator of matches and reveals (data-driven copy, per principles — the app has a voice so users don't have to perform). Seed with the Question Zero thread.
- Reddit: participate honestly in prediction-market and sports-betting communities; ship things worth posting (the daily reveal, absurd nemesis storylines) rather than astroturfing.
- SEO/spectator: every question page is public and indexed ("Will X happen? The crowd says 63%") — evergreen top of funnel.
- Embeds: oEmbed + OG everywhere; a card pasted into any chat should look designed.

**Engagement systems.** Streak protection (one "freeze" earned weekly, capped — no purchases); "Called it" longshot badges; weekly category leaderboards; season archives so records become history.

## 10. Metrics

- **Activation:** visitor → first pick (target: one tap, > 40% of spectator-page visitors).
- **Conversion:** ghost → claimed (measure at streak-3 and picks-5 prompts).
- **Ritual:** DAU/WAU, daily answer rate among claimed users, reveal-attendance rate.
- **Virality:** cards shared per user-week; K-factor = (card views → new ghosts → claims); spectator-page conversion.
- **Depth:** nemesis week completion rate, duo queue depth and rematch rate, chemistry-stat views.
- **Health:** blocked/reported pairing rate; bot-flag rate on ghosts.

## 11. Phasing

**48-hour build (this weekend, around the final):**
- Daily Question end-to-end with ghosts, entry-price stamping from live venue prices, hand-curated question, synchronized reveal, share cards, spectator page with one-tap pick. Manual settlement is acceptable.
- Question Zero campaign on X. Everything else is faked or absent.

**V1 (weeks 1–3):** claiming, profiles, streaks/records, automated settlement, placement flow, fingerprint v1, Assigned Nemesis with narration, Polymarket wallet linking.

**V1.5 (weeks 4–6):** Duo Queue with chemistry and ladder; referral/partner links live; embeds/SEO pass.

**Stretch:** Houses, per §4.4 ship rule. Consensus flavor only after a season of data.

## 12. Open questions

- Confidence slider on picks: richer fingerprint and calibration content vs. added friction on the one-tap loop. Prototype behind a flag.
- Bonus nemesis markets: engine-picked from shared category strengths vs. player-picked (players choosing drifts toward requiring energy — default engine-picked).
- Reveal time zoning: single global reveal (maximum spike, bad for some timezones) vs. regional reveals (better experience, split spike). Start global; revisit with data.
- Kalshi partner path: pending bizdev conversation.
- Name: "Receipts" is a working title; check trademark and app/domain availability before public launch.
