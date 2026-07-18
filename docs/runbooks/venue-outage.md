# Venue outage

What to do when a venue adapter is degraded (§7.5: `venue_degraded:{venue}` set after 3
consecutive `venue:price-tick` failures for that venue).

- Check `/admin/ops` for which venue is flagged and how stale its last successful price update is.
- Prices fall back to the last cached value (`PRICE_FALLBACK_STALENESS_S`); picks keep working off the last known price until the venue recovers.
- The flag clears automatically on the next tick with at least one success — no manual reset needed.
- If the outage persists past a question's lock time, prefer voiding/rescheduling over forcing a stale price — see the settlement-dispute runbook.
