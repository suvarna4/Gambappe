# Venue outage

What to do when a venue adapter is degraded (§7.5: `venue_degraded:{venue}` set after 3
consecutive `venue:price-tick` failures for that venue).

- Check `/admin/ops` for which venue is flagged and how stale its last successful price update is.
- Prices fall back to the last cached value (`PRICE_FALLBACK_STALENESS_S`); picks keep working off the last known price until the venue recovers.
- The flag clears automatically on the next tick with at least one success — no manual reset needed.
- If the outage persists past a question's lock time, prefer voiding/rescheduling over forcing a stale price — see the settlement-dispute runbook.

## Confirmed behavior (WS14-T4 drill)

The `venue_degraded` flag and its clearing were incidentally exercised for real during the
Question Zero drill (`docs/audits/question-zero-drill-log.md`) — the drill environment pointed
`KALSHI_API_BASE` at an unreachable dummy URL (no real venue credentials available), so every
`venue:price-tick` for the drill's fixture market failed with a real network error. Observed:

- `venue:price-tick`'s per-tick report correctly showed `failed: 1, degradedVenues: ["kalshi"]`,
  with a `streak` counter incrementing on each consecutive failure — confirms the 3-consecutive-
  failures threshold logic is live and counting correctly, not just present in code.
- The failures never blocked anything else — `question:lock`, `settlement:poll` (mocked),
  `grade:followup`, and `reveal:fire` all completed normally on schedule despite `kalshi` being
  continuously flagged degraded throughout. This is the intended isolation: a degraded venue
  adapter degrades price freshness, not the rest of the pipeline.

**A misconfigured venue base URL looks identical to a real venue outage on the dashboard.**
Before treating a `venue_degraded` flag as a real incident, confirm `KALSHI_API_BASE` /
`POLYMARKET_*_BASE` are actually pointed at the right environment's real endpoints — this is
exactly the kind of thing that's obvious in a drill (dummy URLs, expected) and easy to
misdiagnose on a real deploy if an env var was typo'd or left pointing at staging.
