# Receipts MVP → v2 — Viral-Potential Assessment & Plan

**Date:** July 18, 2026 · **Inputs:** `receipts-prd.md`, `receipts-principles.md`, `receipts-design-doc.md` §16, the implemented MVP in `app/`, and a two-lens red-team review of the implementation (viral-mechanics analysis benchmarked against Wordle/BeReal/Duolingo/pick'em culture; strict PRD/principles fidelity audit with a P1–P12 scorecard).

---

## 1. Executive assessment

**Verdict: the concept is timely and the core loop is genuinely well-built, but the MVP as shipped cannot go viral — its growth machinery is built and unplugged.** The one-tap anonymous pick → stamped receipt → synchronized reveal loop is the right skeleton, and the engine room (price stamping, secrecy gating, honest percentiles, no fabricated crowds) is unusually disciplined for a hackathon. But every artery that would carry the product between people is severed: shared links unfurl as bare text (no OpenGraph metadata exists anywhere), the Share button sends a naked URL without the card image, the card's own footer link is a fictional domain with no QR, and nothing — no notification, countdown, calendar link, or install prompt — summons a picker back for the reveal. **As implemented, K-factor is structurally ~0 and reveal attendance rests entirely on user memory.** The good news: because the card renderers, secrecy machinery, and ritual mechanics already exist, the fixes are mostly small wiring jobs, not rebuilds. Waves 1–3 below (~4–5 focused days) are the minimum bar to give virality an honest test.

### Why the concept has real potential (social/trend analysis)

- **The cultural moment is right.** Prediction markets went mainstream through the 2024–25 election cycles; Kalshi and Polymarket are household names in the demo's target audience. Simultaneously there is visible sports-betting fatigue — a "bragging rights, never money" positioning is counter-programming with tailwinds, and it sidesteps the ad-policy and app-store-review walls that trap real-money products.
- **"Receipts culture" already exists organically.** Screenshot-proof PnL posting is a native behavior on X. Receipts productizes exactly that behavior with something the screenshots lack: third-party verifiability (P4). The product doesn't have to create the behavior, only capture it.
- **The mechanics rhyme with proven winners.** One shared daily question + a streak + a compact share artifact is the Wordle formula; the synchronized reveal is the BeReal summons; matchmade rivalry is ranked-queue gaming's stranger-to-community engine. Each precedent also teaches a hard lesson the MVP currently fails (see §3): Wordle's artifact pasted as *text* into any chat; BeReal *was* its notification; Duolingo's streak works because the app interrupts you before you break it.
- **Works-alone-by-design defuses the classic social cold start.** A visitor with zero friends gets a complete experience (crowd, percentile, nemesis) — the app manufactures the other side. This is the strongest structural property of the design and the MVP faithfully implements it.

### Honest structural risks (not fixable by wiring)

- **One question/day caps session frequency by design.** That's the Wordle trade: great for ritual and streaks, weak for algorithmic-feed virality. Growth must come from the artifact and the appointment, not from time-in-app.
- **Single global ET schedule** makes the reveal 3 AM in Europe (accepted per D-13; the summons work in Wave 3 partially mitigates).
- **Betting-adjacent stigma** requires permanent copy discipline (P10/INV-8 already enforce this in code — a real asset) and an 18+ posture in every channel.
- **Daily-ritual products post-Wordle are a crowded graveyard.** The differentiated bets are (a) real-market ground truth, (b) verifiable public records as identity, (c) matchmade rivalry. V2 must make all three *visible*, not just present in the database.

---

## 2. Principles scorecard (from the fidelity audit)

| # | Principle | Grade | One-line evidence |
|---|---|---|---|
| P1 | App supplies the energy | **Partial** | Reveal ceremony + narration engine exist, but narrated beats never reach a screen unprompted (no banner, no nav, no surfaced nemesis moment) |
| P2 | Everyone is a stakeholder | **Partial** | One-tap ghost pick is excellent; but spectators on revealed questions and `/vs` pages hit unlinked dead-end text |
| P3 | Loser is the protagonist | **Weak** | Busted-streak card doesn't exist; daily loss card is the win card with a grey stamp — less, not equal-or-greater, investment |
| P4 | Receipts over claims | **Strong** | Server-side price stamping, 300s staleness gate, immutable lock snapshots, status-keyed grading, audited manual settle |
| P5 | Works alone on day one | **Strong** | Cookie-less visitor → one tap → ghost + stamped pick; zero friend dependencies anywhere |
| P6 | One engine, many modes | **Partial** | Clean recompute-from-history, but signals computed ad hoc, category stats written-and-never-read, `market_prices` never populated |
| P7 | Obligations outlive the moment | **Partial** | Streaks/pick log persist publicly; nemesis verdicts vanish into unlinked URLs; badges always empty |
| P8 | Synchronize to concentrate | **Strong** | Fixed ET schedule, silent `graded` state, D-16 secrecy enforced in serializers and tested |
| P9 | Artifacts are doors | **Weak** | Live pages offer one-tap picks, but the cards have no QR, a wrong-domain footer, one size, and no OG wiring back |
| P10 | Ego, never the wallet | **Strong** | No money anywhere; money-regex test guard; 18+ footer; neutral venue link-out only |
| P11 | Plain language | **Strong** | Nemesis/streak/claim/ticket vocabulary; publicness in one sentence; zero invented jargon |
| P12 | Fair fights, engineered drama | **Partial** | Band-then-style matcher implemented and property-tested, but accuracy quantization at the 3-pick floor makes most users unpairable |

---

## 3. Consolidated red-team findings

Deduplicated across both reviews; severity reflects impact on the "drive social engagement from scratch" goal.

### Critical

| ID | Finding | v2 fix | Effort |
|---|---|---|---|
| C1 | **No OpenGraph/Twitter metadata on any page** — every shared link unfurls as generic text with no image, severing the PRD's core distribution thesis; the card routes exist but nothing points at them (`/vs` is also fully client-rendered, invisible to crawlers) | `generateMetadata` on `/q/[id]`, `/u/[handle]`, `/vs/[id]` with `og:image` → existing card routes; add a pre-lock question-level OG card (pick cards 404 pre-lock by design); make `/vs` a server component | S |
| C2 | **The Share button shares a bare `{title, url}`** — the designed ticket never leaves the app, and there is no Wordle-style paste-as-text fallback (`🧾 #12 · YES @ ¢63 → ✓ · streak 4`) | Attach the card PNG via Web Share Level 2 `files:[]` where supported; add copy-image/download fallback; compose a spoiler-safe text line into every share payload | S |
| C3 | **Zero return-loop mechanisms** — no countdown, no `.ics` calendar link, no PWA manifest/install prompt, no opt-in reveal email; the 5s poll only works with the tab open; the reveal plays to an empty room | Countdown to lock/reveal on every question state; "Add reveal to calendar" `.ics` on the stamped ticket; PWA manifest + install prompt after first pick; optional "email me at reveal" collected at claim | M |
| C4 | **Security: the dev sign-in fallback is reachable in production** — a deploy with missing Google env vars silently becomes "type any email, own that account" | Gate on `NODE_ENV !== "production"` (or explicit `ALLOW_DEV_SIGNIN=1`); `/api/claim/start` returns 503 in prod when unconfigured | S |

### High

| ID | Finding | v2 fix | Effort |
|---|---|---|---|
| H1 | Card footer prints a hardcoded fictional `receipts.app` + truncated UUID; no QR despite the dependency being installed — the flagship screenshot artifact is a door to nowhere (P9) | Real `APP_BASE_URL` short links + QR data-URI on all card routes | S |
| H2 | No story-format (1080×1920) card — IG/TikTok stories, the highest-velocity 2026 share surface, are unserved (§16.1 promised both sizes) | `?format=story` vertical variant on card routes | S |
| H3 | **The empty-room problem**: raw counts everywhere ("2 players in", "Final split: 2–1") broadcast emptiness at small N | Threshold (~25) below which counts become ordinal framing ("You're picker #3 today — early") and the *market's* probability serves as the crowd ("the market says 63%" — always big-N, always true) | S |
| H4 | Returning claimed users are permanently locked out — `claim.ts` dead-ends any existing email and no sign-in path exists; one cookie-clear or phone upgrade loses the "portable" track record forever | Plain sign-in for existing identities (abandon current ghost; keep hard merge deferred) | S/M |
| H5 | The profile isn't flex-worthy for the creator/tout wedge: random animal handle with no customization, `calledItCount` hardcoded 0, `badges` always `[]`, no profile OG card, no share button | Pick-your-handle at claim; compute Called-it in `recomputeUserStats`; badge row; profile OG card; share button | M |
| H6 | Ritual supply chain is one hand-fed question keyed to today with no queue; a missed morning puts dead-end copy on the front door on habit-formation day | Admin queue N days ahead (schema already supports it); "tomorrow's question drops at 9 AM" teaser instead of dead-end copy; rules-drafted Kalshi candidates for one-tap approval | M |
| H7 | Picking hard-depends on an every-minute external cron: staleness >5 min bricks the core loop (Vercel Hobby can't even run 1-min crons); no refresh-on-demand path | Inline server-side price refresh before rejecting on staleness; alert on price lag | M |
| H8 | Spectators on revealed questions and `/vs` pages hit dead ends — no CTA, no navigation anywhere in the app (P2/P9 at the highest-traffic viral entry point) | Persistent "Today's question →" CTA on revealed/`/vs` surfaces; minimal header nav (today / me / rivalry) | S |
| H9 | Nemesis assignment produces no user-visible moment — rows are written, no banner/link/notification surfaces "Meet your nemesis"; verdicts vanish into unlinked URLs (P1/P7) | Home-page banner from `/api/nemesis/current` (assignment + verdict states); rivalry history section on profiles | M |
| H10 | Busted-streak card absent; daily loss card is the de-saturated win card with no story (P3 — "the loser is the protagonist" is the brand) | Dedicated busted-streak card ("6 days. Gone."); loss-specific art + one data line ("Took the 63¢ side. The 37% happened.") | M |

### Medium

| ID | Finding | v2 fix | Effort |
|---|---|---|---|
| M1 | Matcher accuracy-band quantization at the 3-pick floor makes most users unpairable (smallest gap ⅓ > 0.15 band); §16.5's explicit admin-pair override never built | Scale band to `max(BAND, 1/n + ε)`; add `POST /api/admin/nemesis/pair` | S |
| M2 | Four allowlisted funnel events never emitted (`spectator_view`, `reveal_attended`, `claim_prompt_shown`, `card_view`) — PRD §10 activation/K-factor/ritual metrics are unmeasurable | Fire them from the obvious call sites | S |
| M3 | "Live" price and its "as of" label freeze at page load while open (no polling in `open` state) — the demo's first beat is a static snapshot | Poll in `open` too; 1s re-render of the relative timestamp | S |
| M4 | Percentile beat silently vanishes at small N with no substitute | Min pool ~10 for percentile; below it, rank framing + market-relative line ("The market had this at 63¢ — you took the other side") | S |
| M5 | `market_prices` history table never written — no future fingerprint inputs, no audit trail for disputed stamps | One insert per poll | S |
| M6 | Admin audit rows only on settle; "typed confirmation" is an OK/Cancel dialog; prod admin gate has no bootstrap path (DB-UUID allowlist, discoverable only via psql) | Audit every admin route; real `prompt()` typing; `ADMIN_EMAILS` or one-time bootstrap token | S |
| M7 | Google-only claim while the audience is X-native (PRD promised email/X/passkey) | Email magic link first, X OAuth second | M |
| M8 | No referral attribution on shared URLs — the sharer→landing chain is unmeasurable | `?via={handle}` + landing event | S |

### Low

Draft questions publicly served pre-open (404 them) · `/nemesis` shows ghosts misleading "keep picking" copy with no claim CTA (the nemesis is supposed to be the conversion carrot) · seeded FakeVenue market's "Trade on Kalshi" URL 404s on the real kalshi.com · `POST /api/events` can 500 on malformed JSON · nemesis card's `questionsRemaining` is a constant · global ET reveal is 3 AM in Europe (accepted; mitigated by the summons work).

---

## 4. MVPv2 plan

Ordering principle: **plug in the loop before pouring traffic into it.** Waves 1–3 are the minimum honest test of virality; 4–6 compound it.

### Wave 1 — Plug in the growth engine (1–2 days) — C1, C2, H1, H2, M8
Every page unfurls as its designed card on X/Discord/iMessage/Slack; every share carries the image + a paste-safe text line + an attributed link; every card carries a working QR and real domain; story-format renders exist.
**AC:** paste a `/q`, `/u`, `/vs` link into X and Discord → card unfurls; `navigator.share` on a phone attaches the PNG; scan the card QR → live page; `card_view`/`via` events land.

### Wave 2 — Safety & reliability (1 day) — C4, H7, M6, plus low fixes
Dev sign-in unreachable in production; picking survives cron gaps via inline price refresh; admin bootstrap + full audit; drafts hidden; events route hardened.
**AC:** prod build with no Google creds → claim returns 503, not impersonation; pick succeeds with cron stopped ≤ staleness window; every admin action writes an audit row.

### Wave 3 — The summons (1–2 days) — C3, M3, M4, H3
The appointment becomes visible and joinable: countdowns everywhere, calendar links, PWA install prompt after first pick, opt-in reveal email; live price actually live; small-N surfaces framed as early, never empty; percentile always renders *something*.
**AC:** a picker who closes the tab has ≥2 honest routes back (calendar, installed PWA, email); no surface ever prints a raw count < 25.

### Wave 4 — Doors & drama (2 days) — H8, H9, H10, M1
Every spectator surface has a one-tap door; nemesis assignment and verdicts arrive as moments (banner + cards) and persist on profiles; the busted-streak card ships and the loss artifact gets real art direction; the matcher actually pairs small-N users, with an admin override.
**AC:** revealed-question visitor reaches a stamped pick in ≤2 taps; "Meet your nemesis" appears on the home page within one poll of assignment; the busted-streak card is the best-looking card in the taxonomy (review side-by-side, P3).

### Wave 5 — Identity & the creator wedge (2 days) — H4, H5, M7
Returning sign-in (no more one-cookie-clear churn); email magic link + X OAuth; choose-your-handle at claim; Called-it badges computed and displayed; profile OG card + share button.
**AC:** clear cookies, sign back in, record intact; a tout can claim `@theirbrand`, pin `receipts/u/theirbrand` on X, and it unfurls as a track-record card.

### Wave 6 — Ritual ops (1–2 days) — H6, M2, M5
Question queue N days ahead with one-tap approval of rules-drafted Kalshi candidates; "tomorrow drops at 9 AM" teaser state; full funnel instrumentation; price history writes.
**AC:** operator can load a week of questions in one sitting; missing a morning shows a teaser, never a dead end; every PRD §10 metric is computable from the events table.

**Explicitly still out of scope for v2** (per design-doc §16.2, unchanged): Duo Queue, Houses, placement, wallet linking, Glicko, threads/reactions, web push (email + PWA + calendar are the v2 summons), leaderboards (revisit in v2.5 as the weekly category board — it is the missing P7 surface with the best flex value).

**What v2 must never do** (principles as guardrails): no fabricated crowds or fake counts (P4 — the market-as-crowd framing is the honest alternative); no purchasable anything; no money language anywhere (the regex test stays); no dark-pattern summons (calendar/email/PWA are all opt-in artifacts of a pick the user chose to make).

---

## 5. Go-to-market & adoption plan

Organic-first by necessity and by fit: paid acquisition for betting-adjacent products is walled off on most platforms, and the brand is "receipts, not ads." Being web-only (no app store) means no gambling-review gate and instant link-based distribution — lean into it.

### Positioning

> **"Bragging rights, on the record."** The no-money flex layer for prediction culture: every call timestamped and price-stamped against real markets, every record public and verifiable. Small money stays on the venues; the dignity lives here.

Three audiences, one loop: (1) **prediction-market X** — wants verifiable track records; (2) **group chats** — wants to settle arguments with receipts; (3) **daily-game players** (Wordle/NYT cohort) — wants a 10-second ritual with a streak. All three are served by the same card→page→pick loop.

### Phase 0 — Pre-flight (week 0, requires Waves 1–3)
- Seed a 14-day question queue; recruit 30–50 friendlies for a closed dry-run week to warm the crowd numbers past the small-N thresholds and shake out the funnel.
- Verify the unfurl matrix by hand on X, Discord, iMessage, Slack, WhatsApp, Reddit.
- Stand up the official X account **as the narrator, not a brand account** (P1: data-driven match copy — the app has a voice so users don't have to perform).

### Phase 1 — The Question Zero moment (launch weekend)
- One flagship communal event, one question, one URL, per PRD §9 (the World Cup final was the design's candidate; any scheduled cultural spike works — finals, elections, award shows, launches). The campaign *is* the spectator URL.
- Run the reveal as content: the official account live-narrates lock ("14,203 in. 63¢ says yes."), posts the crowd-split card at lock, and the outcome card at reveal. Screen-record the reveal ceremony for a vertical clip — the stamp-slam sequence is the TikTok/Reels asset.
- Losing side gets the spotlight: the post-reveal thread leads with the best busted tickets (volunteered/self-posted — quote-RT the loss cards). "Losing publicly with style" is the most differentiated content the product can produce (P3).

### Phase 2 — The creator wedge (weeks 1–3, requires Wave 5)
- Hand-recruit 20–30 mid-tier (5k–100k) prediction/sports X accounts: reserved handle + early "verified track record" framing. The pitch is the PRD's own: betting X is full of unverifiable touts; a pinned link that *proves* your record is genuinely valuable. Every tout who adopts the profile as proof is a permanent, free distribution node.
- A weekly "receipts check" ritual post from the narrator account: the week's best verified calls (and best-dressed losses) with profile links — gives creators a reason to compete for the feature.

### Phase 3 — The group-chat wedge (weeks 2–6)
- The share card is the wedge; make the chat the destination: "send this to the friend who's always wrong" copy on loss cards; `?via=` attribution to measure which cards actually convert chats.
- v2.5 candidate feature (passes the lateral checklist; park until the loop is proven): a "same question, your group" link — one tap creates a private crowd-split for a chat group over the *same* daily question. No new mechanics, pure multiplayer framing of the existing loop.

### Phase 4 — Community & evergreen (weeks 3–8)
- Honest participation in prediction-market and sports Reddit/Discords: ship things worth posting (absurd nemesis storylines, the daily reveal thread) rather than astroturfing — per PRD §9's own rule.
- SEO pass once question volume exists: every revealed question page is an evergreen "Will X happen? The crowd said 63%, the market said 58%" record (design-doc H5 scope).
- Nemesis narration excerpts as a content format: the narrator account posts the week's best rivalry verdict cards.

### Measurement (PRD §10, computable after Wave 6)
- **Activation:** spectator → pick > 40% (the one-tap bar). Watch per-channel: X vs. chat vs. QR.
- **K-factor chain:** `card_view` → `ghost_minted(via)` → `claim_completed`; target K > 0.4 by week 4 or revisit the artifact, not the channels.
- **Ritual:** reveal attendance among day's pickers (target > 35% with the Wave-3 summons; < 15% means the summons failed, not the content).
- **Conversion:** ghost→claim at streak-3 and picks-5 prompts (target 25%+ at streak-3 — loss-aversion framing).
- **Kill criteria honesty:** if after 4 weeks K < 0.2 *with the loop verified working*, the artifact isn't carrying — iterate the card itself (the text-line format, the loss framing) before spending on channels.

### Guardrails
18+ in every bio, footer, and channel; no marketing in under-18-skewed channels (hard line); copy discipline everywhere — "calls," "picks," "streaks," never "bets" or money language (already enforced in-app by test; extend the same regex to the social copy pipeline); venue links stay neutral and are never the CTA of any post.

---

## 6. Bottom line

The MVP proves the engine is honest; it does not yet prove the product can spread, because nothing that leaves the app can find its way back. Waves 1–3 (~4–5 days) plug in the already-built growth machinery, secure the one real security hole, and give the ritual a summons — that is the minimum credible experiment. Waves 4–6 make the drama visible and the identity ownable, which is what the PRD's creator wedge and the principles' loser-protagonist brand actually run on. The GTM is organic-by-design: one synchronized flagship moment, then let the tout wedge and the group-chat wedge compound — measured, from day one, by the K-factor chain the PRD already specified.
