# Receipts — Project Plan

**Based on:** receipts-prd.md v0.1 · **Plan date:** July 17, 2026
**Anchor event:** World Cup final, Sunday July 19, 2026 (Question Zero)

---

## 1. Objective

Ship a social layer on regulated prediction markets where the app manufactures the crowd, stakes, and drama. Launch a minimal Daily Question around the World Cup final in 48 hours, then build to V1 (Nemesis) and V1.5 (Duo Queue) on a single fingerprint/rating engine. No money ever touches the product.

## 2. Milestones at a glance

| Milestone | Dates | Gate to pass |
|---|---|---|
| **M0: Question Zero** | Jul 17–19 | Live spectator page, one-tap ghost picks, price-stamped entries, synchronized reveal, share card |
| **M1: V1 core** | Jul 20 – Aug 7 | Claiming, profiles, streaks, automated settlement, fingerprint v1, Assigned Nemesis, Polymarket linking |
| **M2: V1.5 social depth** | Aug 10 – Aug 28 | Duo Queue with chemistry + ladder, referral links, embeds/SEO pass |
| **M3 (stretch): Houses** | Season boundary after M2 | Ships only when pick history makes sorting feel accurate (PRD §4.4 ship rule) |

## 3. Phase detail

### Phase 0 — Question Zero (Fri Jul 17 → Sun Jul 19)

Scope is ruthlessly minimal; manual settlement is acceptable.

- **Fri:** Repo scaffolding; ghost identity (device cookie + generated handle); Kalshi/Polymarket price polling + cache for one hand-curated market; pick storage with venue, market ID, side, timestamp, entry price.
- **Sat:** Question page (spectator, no auth, cacheable) with one-tap pick; lock mechanism at fixed deadline; share-card renderer (side, entry price, live %, handle, QR/link) with OG images; reveal screen with motion.
- **Sun:** Question Zero live before kickoff; official X account narrates; manual settlement + reveal at final whistle; capture metrics (visitor→pick rate, card shares, new ghosts).
- **Out of scope:** accounts, streak logic beyond a counter, everything in §4.2–4.4.

### Phase 1 — V1 (Mon Jul 20 → Fri Aug 7, 3 weeks)

**Week 1 (Jul 20–24): identity + automation.**
Claiming (email/OAuth/passkey, 18+ attestation, one-sentence publicness disclosure); ghost→account migration; automated market selection rules + settlement from venue resolution feeds; manual override tooling; daily question cadence running unattended.

**Week 2 (Jul 27–31): records + engine.**
Public profiles (pick log, streaks, category records, accuracy, edge); placement flow (5 past markets); nightly fingerprint job (Brier, edge, chalk affinity, contrarianism, category profile, timing); Glicko-2 ratings; streak freeze mechanic; "Called it" longshot badges.

**Week 3 (Aug 3–7): Nemesis.**
Weekly matchmaking batch (rating band → max style distance → category-overlap floor → timezone preference, greedy matching with swaps); Monday reveal cards; head-to-head scoring with edge tiebreaker; data-driven narration templates + notification beats; verdict cards; block/report + pause; Polymarket wallet linking (SIWE nonce signature, read-only, bucketed sizes); eligibility thresholds (nemesis at 5 picks, duo at 10).

### Phase 1.5 — V1.5 (Mon Aug 10 → Fri Aug 28, 3 weeks)

- **Week 4:** Duo matchmaking (complementarity pairing, predicted synergy seed); match format (6 shared markets / 3 days); duo Glicko-2.
- **Week 5:** Chemistry stat (realized vs. expected joint accuracy) feeding back into matchmaking; ladder with tiers, promotion/relegation, weekly windows; partner persistence by mutual consent.
- **Week 6:** oEmbed + OG polish everywhere; SEO-indexed question pages; referral/partner parameters on outbound links; profile-page polish for the creator wedge; season archives.

### Stretch — Houses

k-means (k=4) sorting over style axes at a season boundary; house season scoring with per-member contribution cap; consensus flavor only after a full season of data. Do not schedule until the ship-rule gate passes.

## 4. Workstreams and ownership

| Workstream | Covers | Active phases |
|---|---|---|
| Product/frontend | Question page, reveal, profiles, share cards, ticket design system | 0, 1, 1.5 |
| Engine | Fingerprint, ratings, matchmaking (nemesis, duo), placement | 1, 1.5 |
| Venue integration | Kalshi/Polymarket data, caching, settlement, wallet linking | 0, 1 |
| Growth | X narration, Question Zero campaign, Reddit presence, SEO/embeds | 0 onward |
| Trust & integrity | Rate limits, bot heuristics, block/report, account deletion | 1 onward |
| Bizdev | Kalshi partner/read-only path, referral programs (apply to both), trademark/name check | parallel, non-blocking |

## 5. Dependencies and critical path

- Question Zero is the hard deadline; everything in Phase 0 is critical path. If the share-card renderer slips, ship the page without it — the spectator URL is the campaign.
- Automated settlement (wk 1) blocks fingerprint quality (wk 2), which blocks Nemesis matchmaking (wk 3). This chain is the V1 critical path.
- Nemesis narration quality gates the mode's virality — allocate real design/copy time, not leftover time.
- Duo Queue depends on Glicko-2 ratings and eligibility thresholds from V1.
- Kalshi partner conversation and referral applications are non-blocking; start immediately.

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Venue API rate limits or outages during reveal spikes | Broken flagship moment | Aggressive caching; spectator pages never fan out to venue APIs; static fallback |
| Thin matchmaking pools early | Unfair or missing nemesis matches | High-uncertainty Glicko bands widen automatically; skip-week fallback with crowd-only scoring |
| Bot-inflated ghost pools | Corrupted leaderboards and matchmaking | Rate limits + device heuristics from day one of V1 |
| Bad first sort in Houses | Alienated users | Ship rule already gates this; don't override it |
| "Receipts" name conflict | Rebrand cost post-traction | Trademark/domain check during V1, before any paid promotion |
| Regulatory perception drift | Existential | Enforce §2 posture in review: no money, no credentials, no stake-size features — ever |

## 7. Success metrics per phase

- **M0:** >40% of spectator visitors make a pick; card share count; new ghosts per card view.
- **M1:** ghost→claim conversion at streak-3 and picks-5 prompts; daily answer rate; reveal attendance; nemesis week completion.
- **M2:** duo queue depth; rematch rate; K-factor (card views → ghosts → claims); DAU/WAU.
- **Health throughout:** report rate on pairings; bot-flag rate.

## 8. Open decisions (owner: product)

1. Confidence slider — prototype behind a flag during Week 2; decide by end of V1.
2. Bonus nemesis markets — default engine-picked; revisit only on user demand.
3. Reveal zoning — start with a single global reveal; revisit with M1 attendance data.
4. Final name — resolve before V1.5 marketing spend.
