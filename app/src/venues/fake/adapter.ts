import type { VenueAdapter, VenueMarket } from "../types";

export interface FakeMarketScript {
  venueMarketId: string;
  title: string;
  category: VenueMarket["category"];
  yesLabel: string;
  noLabel: string;
  closeTime: Date | null;
  url: string;
  /** Ordered price points; getPrice always returns the latest one whose `at` has passed clock.now(). */
  priceWalk: { at: Date; priceYes: number }[];
  /** When resolution should become visible, and what it resolves to. */
  resolution: { at: Date; outcome: "yes" | "no" | "void" } | null;
}

const registry = new Map<string, FakeMarketScript>();

export function registerFakeMarket(script: FakeMarketScript): void {
  registry.set(script.venueMarketId, script);
}

export function clearFakeMarkets(): void {
  registry.clear();
}

/** Deterministic in-memory fixture builder for tests/rehearsal (§5.1). */
export function buildFakeMarket(
  overrides: Partial<FakeMarketScript> & { venueMarketId: string }
): FakeMarketScript {
  return {
    title: "Will it happen?",
    category: "other",
    yesLabel: "Yes",
    noLabel: "No",
    closeTime: null,
    url: `https://example.test/fake/${overrides.venueMarketId}`,
    priceWalk: [{ at: new Date(0), priceYes: 0.5 }],
    resolution: null,
    ...overrides,
  };
}

function latestPrice(script: FakeMarketScript, now: Date): number | null {
  const past = script.priceWalk.filter((p) => p.at.getTime() <= now.getTime());
  if (past.length === 0) return null;
  return past[past.length - 1].priceYes;
}

export const fakeAdapter: VenueAdapter = {
  venue: "fake",

  async getMarket(venueMarketId) {
    const s = registry.get(venueMarketId);
    if (!s) return null;
    return {
      venueMarketId: s.venueMarketId,
      title: s.title,
      category: s.category,
      yesLabel: s.yesLabel,
      noLabel: s.noLabel,
      closeTime: s.closeTime,
      priceYes: latestPrice(s, new Date()),
      url: s.url,
    };
  },

  async getPrice(venueMarketId) {
    const s = registry.get(venueMarketId);
    if (!s) return null;
    const now = new Date();
    const priceYes = latestPrice(s, now);
    if (priceYes === null) return null;
    return { priceYes, observedAt: now };
  },

  async getResolution(venueMarketId) {
    const s = registry.get(venueMarketId);
    if (!s || !s.resolution) return null;
    const now = new Date();
    if (s.resolution.at.getTime() > now.getTime()) return null;
    return { outcome: s.resolution.outcome, settledAt: s.resolution.at };
  },
};
