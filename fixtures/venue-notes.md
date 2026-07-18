# Venue notes (WS1-T2/T3/T6, §7.2)

Endpoints called by each adapter, plus a **SPEC-GAP** flag on everything that could not be
verified against live venue docs in this sandbox (no network egress to kalshi.com /
polymarket.com / gamma-api.polymarket.com / clob.polymarket.com is available here — see
env README `/root/.ccr/README.md`).

## Kalshi (`packages/venues/src/kalshi/`)

Base URL: env `KALSHI_API_BASE` (e.g. `https://trading-api.kalshi.com/trade-api/v2` prod,
a demo/sandbox base for dev — exact demo host TBD, see SPEC-GAP below).

Endpoints used:

- `GET {base}/markets?status=open&limit=200&cursor=...` — catalog listing for
  `listCandidateMarkets` (§7.5 `venue:sync-catalog`). Client-side filtered by close-time
  window and liquidity floor; paginated via `cursor` up to 5 pages.
- `GET {base}/markets/{ticker}` — single market lookup, used by `getMarket`, `getYesPrice`,
  and `getResolution` (all three read the same object; Kalshi's market payload doesn't
  appear to expose a separate price-quote-with-timestamp endpoint in the docs we have
  training-data knowledge of, so `getYesPrice`'s `ts` is the local fetch instant, not a
  venue-reported quote time).

**SPEC-GAP(WS1-T2-1) — rate limits.** §7.2 requires "respect venue-published tiers when
confirmed." We could not fetch Kalshi's current rate-limit documentation live, so the
adapter uses the conservative default (`VENUE_RATE_LIMIT_RPS` = 4 req/s) unconditionally.
A human/future task should verify Kalshi's actual published tier (historically documented
around 10 req/s for unauthenticated/basic tiers, but this needs re-confirmation against
current docs) before raising the configured rps in production.

**SPEC-GAP(WS1-T2-2) — exact market JSON shape.** `packages/venues/src/kalshi/schemas.ts`
is a best-effort reconstruction of the Kalshi trade API v2 `/markets` and `/markets/{ticker}`
response shape from training-data knowledge (fields: `ticker`, `event_ticker`,
`market_type`, `title`, `category`, `status`, `result`, `close_time`, `expiration_time`,
`yes_bid`/`yes_ask`/`no_bid`/`no_ask` in cents, `last_price`, `liquidity`, `volume`). This
has NOT been verified against a live response. In particular:

- The exact `status` vocabulary (`open`/`closed`/`settled`/`finalized`/...) and whether both
  `settled` and `finalized` are real, distinct terminal states needs verification.
- The exact `result` token used for voided/no-contest markets (`"void"` assumed here) is
  unverified — Kalshi's real API may represent voids differently (e.g. a distinct market
  `status` rather than a `result` value). Per DD-7/§7.3 "never guess," anything that doesn't
  match `yes`/`no`/`void`/`voided` on a settled/finalized market is treated as `unresolved`,
  so an unverified void representation fails safe (stays unresolved, retried by
  `settlement:poll`) rather than mis-grading.
- Whether individual Kalshi `market` objects can ever be non-binary (`market_type !==
  'binary'`) is unverified — Kalshi's real product model is "one market = one binary
  yes/no contract," with multi-option events expressed as several sibling markets under one
  `event_ticker`, not a single multi-outcome market object. The `market_type` filter here is
  a defensive placeholder satisfying DD-7/the WS1-T2 AC pending live confirmation; it may be
  dead code against the real API (harmless either way — it will simply never trigger).
- `venueUrl` (`https://kalshi.com/markets/{ticker}`) is a best-guess link pattern, not
  verified against Kalshi's current site routing.

None of the above blocks WS1-T2 (contract suite + unit ACs all pass against the hand-authored
fixtures), but production cutover should re-verify this file against current Kalshi docs
first (design doc R1 risk row).

### Kalshi WS ticker (`packages/venues/src/kalshi/ws-ticker.ts`, WS1-T6, P1.5, flag `kalshi_ws_ticker`)

Endpoint: `wss://{KALSHI_API_BASE with http(s)->ws(s)}/ws/v2` (derived, not independently
verified). Subscribe message shape (`{id, cmd:'subscribe', params:{channels:['ticker'],
market_tickers:[...]}}`) and inbound ticker payload shape (`{msg:{market_ticker, yes_bid,
yes_ask}}`) are both **SPEC-GAP(WS1-T6)** best-effort reconstructions, unverified live.

This is explicitly a P1.5 flourish, not load-bearing: `venue:price-tick` (WS1-T4, the source
of record for stamped prices and grading) does not import or depend on `ws-ticker.ts` in any
way — grep `apps/worker/src` for `ws-ticker` to confirm zero references. `subscribe()` is
also a safe no-op whenever the `kalshi_ws_ticker` flag is off (default) or `KALSHI_API_BASE`
is unset, and any malformed/unexpected WS message is swallowed (never thrown) rather than
surfaced as a failure. Killing the WS connection therefore causes zero functional loss by
construction, not merely by test coverage.

## Polymarket (`packages/venues/src/polymarket/`)

Base URLs: env `POLYMARKET_GAMMA_BASE` (Gamma API, market metadata) and
`POLYMARKET_CLOB_BASE` (CLOB API, order-book midpoint).

Endpoints used:

- `GET {gamma}/markets?active=true&closed=false&limit=...` — catalog listing for
  `listCandidateMarkets`, filtered to `outcomes = ["Yes","No"]` (binary only, DD-7).
- `GET {gamma}/markets/{id}` (or `?slug=`/`?condition_id=` — see SPEC-GAP) — single market
  lookup for `getMarket`/`getResolution`, and the `outcomePrices` fallback for price.
- `GET {clob}/midpoint?token_id={yesTokenId}` — CLOB order-book midpoint for the YES token,
  primary price source; falls back to Gamma's `outcomePrices[0]` when the CLOB call fails or
  the token isn't actively quoted.

**SPEC-GAP(WS1-T3-1) — rate limits.** Same posture as Kalshi: current published Gamma/CLOB
rate-limit tiers were not re-verified live; `VENUE_RATE_LIMIT_RPS` (4 req/s) is used
unconditionally as the conservative default.

**SPEC-GAP(WS1-T3-2) — exact market JSON shape.**
`packages/venues/src/polymarket/schemas.ts` is a best-effort reconstruction of the Gamma
`/markets` response shape (fields: `id`, `question`, `category`, `outcomes` as a JSON-string-
encoded array, `outcomePrices` as a JSON-string-encoded array, `clobTokenIds` as a
JSON-string-encoded array, `active`, `closed`, `archived`, `endDate`, `liquidity`,
`umaResolutionStatus`) and of the CLOB `/midpoint` response (`{"mid": "0.xx"}`), not verified
against a live response. In particular:

- Gamma is documented to return several array-typed fields (`outcomes`, `outcomePrices`,
  `clobTokenIds`) as JSON-encoded **strings** rather than native JSON arrays in some API
  versions; the adapter defensively parses both shapes (string-encoded or native array) but
  this dual-parsing has not been exercised against a real live payload.
- The exact field/value Polymarket uses to signal an active UMA dispute
  (`umaResolutionStatus` assumed here, values including something like `"disputed"`) is
  unverified. Per §7.4 "disputes/UMA in-flight → unresolved," any resolution mapping that
  doesn't cleanly resolve to `closed` + a clean Yes/No `outcomePrices` split stays
  `unresolved`.
- The `venueUrl` link pattern (`https://polymarket.com/event/{slug}`) is a best guess.

None of the above blocks WS1-T3 (contract suite + unit ACs all pass against the hand-authored
fixtures), but production cutover should re-verify this file against current Polymarket docs
first (design doc R1 risk row).

## Polymarket wallet import (`packages/venues/src/polymarket/data-api.ts`, `proxy.ts`, WS12-T2, §12.3–12.4)

A SEPARATE surface from the Gamma/CLOB adapter above — read-only position/trade history for
wallet-link enrichment (never market data). No network egress to `data-api.polymarket.com` or
to a Polygon RPC endpoint was available in this sandbox to verify either piece below.

**SPEC-GAP(WS12-T2-1) — data API response shape.** `data-api.ts`'s `polymarketPositionSchema`/
`polymarketActivitySchema` are best-effort reconstructions from training-data knowledge of the
public `GET {POLYMARKET_DATA_BASE}/positions?user=` and `GET {POLYMARKET_DATA_BASE}/activity?user=`
endpoints (fields: `conditionId`, `title`, `category`, `outcome`, `size`, `avgPrice`,
`initialValue` for positions; `type`, `timestamp`, `usdcSize`, `price` for activity). Not
verified against a live response. Every field beyond the bare minimum is optional so an
unexpected-but-plausible real shape degrades a position's contribution to the derived priors
rather than throwing; `getPositions` still throws on a genuine non-404 HTTP/network failure
(never a silently-wrong empty "success"), while `getActivity` is treated as a secondary,
best-effort source and never throws (§12.4 "timing prior... null if unavailable").

**SPEC-GAP(WS12-T2-2) — Polymarket proxy-wallet factory constants, deliberately left unset.**
Per the design doc's own instruction ("must not be guessed"), `proxy.ts`'s
`POLYMARKET_PROXY_FACTORY_ADDRESS` / `POLYMARKET_PROXY_INIT_CODE_HASH` are `null`, not a
guessed value — no live docs/contract were reachable to confirm them in this sandbox. The
documented §12.3 fallback ("query the data API for the EOA address only, badge reads 'wallet
verified' without imported history") is therefore this module's SAFE DEFAULT today, not a
degraded/error path — `resolvePolymarketProxy` always returns `{proxyAddress: null, verified:
false}` until a human fills in the two constants above from a verified source. The CREATE2
derivation itself (`computeCreate2ProxyAddress`, EIP-1014 via viem) and the assumed
"salt = keccak256(owner address)" convention (`saltFromOwner`) are implemented and
unit-tested for correctness/determinism against viem's own address derivation, but the salt
convention itself is ALSO unverified against Polymarket's actual factory contract — a human
wiring in the real constants should double-check the salt scheme matches before flipping
`verified: true` on for real. The AC calling for verification "against 2 known real address
pairs" could not be met here for the same no-network-egress reason; that verification step is
left for whoever supplies the real constants.

None of the above blocks WS12-T2 (the privacy/bucketing unit tests and the fallback-path test
pass without any real Polymarket data), but wallet-import history should not be trusted to
actually populate (beyond the empty-history fallback) until both SPEC-GAPs above are resolved
against live Polymarket sources.
