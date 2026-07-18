/**
 * Real venue adapters for the worker (§7.3–7.4, WS1-T4/T5). Constructed lazily (env vars are
 * only required once a venue job actually runs — not at module import / registry-load time)
 * and cached so the shared HTTP client's rate limiter persists across job ticks instead of
 * resetting every run.
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
