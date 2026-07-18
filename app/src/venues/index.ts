import type { VenueAdapter } from "./types";
import { kalshiAdapter } from "./kalshi/adapter";
import { fakeAdapter } from "./fake/adapter";

// Server-only registry (cron/admin code, never page components — INV-5).
export function getAdapter(venue: "kalshi" | "polymarket" | "fake"): VenueAdapter {
  if (venue === "kalshi") return kalshiAdapter;
  if (venue === "fake") return fakeAdapter;
  throw new Error(`Polymarket adapter not built at MVP scope (§16.2): ${venue}`);
}

export type { VenueAdapter, VenueMarket } from "./types";
export { registerFakeMarket, buildFakeMarket, clearFakeMarkets } from "./fake/adapter";
export type { FakeMarketScript } from "./fake/adapter";
