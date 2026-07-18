/**
 * Venue adapters for the ONE narrow §2.2 exception where `apps/web` calls a venue API
 * synchronously in a request path: the §6.2 step 4 pick-time price freshness fallback. Mirrors
 * `apps/worker/src/venues.ts`'s lazy-singleton construction so the shared HTTP client's rate
 * limiter persists across requests instead of resetting per call.
 */
import { KalshiAdapter, PolymarketAdapter, type VenueAdapter } from '@receipts/venues';

let cached: VenueAdapter[] | undefined;

export function defaultVenueAdapters(): VenueAdapter[] {
  cached ??= [new KalshiAdapter(), new PolymarketAdapter()];
  return cached;
}

/** Test-only escape hatch: inject mock/scripted adapters. */
export function setVenueAdaptersForTesting(adapters: VenueAdapter[] | undefined): void {
  cached = adapters;
}
