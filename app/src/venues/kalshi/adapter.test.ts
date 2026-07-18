import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kalshiAdapter } from "./adapter";

// Recorded-shape fixture per Kalshi's public /markets/{ticker} payload (§5.1, §11).
const OPEN_MARKET_FIXTURE = {
  market: {
    ticker: "FAKE-KALSHI-TICKER",
    title: "Will the sun rise tomorrow?",
    category: "Culture",
    yes_sub_title: "Yes",
    no_sub_title: "No",
    close_time: "2026-07-19T12:00:00Z",
    status: "open",
    yes_bid: 61,
    yes_ask: 65,
    result: "",
  },
};

const SETTLED_MARKET_FIXTURE = {
  market: {
    ...OPEN_MARKET_FIXTURE.market,
    status: "settled",
    result: "yes",
  },
};

describe("Kalshi adapter (fixture-parsed)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(OPEN_MARKET_FIXTURE), { status: 200 }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parses market metadata and midpoint price", async () => {
    const market = await kalshiAdapter.getMarket("FAKE-KALSHI-TICKER");
    expect(market?.title).toBe("Will the sun rise tomorrow?");
    expect(market?.priceYes).toBeCloseTo(0.63, 5); // (61+65)/2/100
    expect(market?.category).toBe("culture");
    expect(market?.url).toContain("fake-kalshi-ticker");
  });

  it("getPrice returns the midpoint", async () => {
    const price = await kalshiAdapter.getPrice("FAKE-KALSHI-TICKER");
    expect(price?.priceYes).toBeCloseTo(0.63, 5);
  });

  it("getResolution returns null while unresolved", async () => {
    const resolution = await kalshiAdapter.getResolution("FAKE-KALSHI-TICKER");
    expect(resolution).toBeNull();
  });

  it("getResolution returns the outcome once settled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(SETTLED_MARKET_FIXTURE), { status: 200 }))
    );
    const resolution = await kalshiAdapter.getResolution("FAKE-KALSHI-TICKER");
    expect(resolution?.outcome).toBe("yes");
  });
});
