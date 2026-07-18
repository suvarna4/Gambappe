import { describe, it, expect, beforeEach } from "vitest";
import { fakeAdapter, registerFakeMarket, clearFakeMarkets, buildFakeMarket } from "./adapter";

describe("FakeVenue adapter", () => {
  beforeEach(() => clearFakeMarkets());

  it("drives a full question lifecycle: open -> price drift -> settle", async () => {
    const t0 = new Date(Date.now() - 10_000);
    const t1 = new Date(Date.now() - 5_000);
    const tSettle = new Date(Date.now() - 1_000);

    registerFakeMarket(
      buildFakeMarket({
        venueMarketId: "FAKE-Q0",
        title: "Will it happen?",
        priceWalk: [
          { at: t0, priceYes: 0.5 },
          { at: t1, priceYes: 0.63 },
        ],
        resolution: { at: tSettle, outcome: "yes" },
      })
    );

    const market = await fakeAdapter.getMarket("FAKE-Q0");
    expect(market?.title).toBe("Will it happen?");

    const price = await fakeAdapter.getPrice("FAKE-Q0");
    expect(price?.priceYes).toBe(0.63);

    const resolution = await fakeAdapter.getResolution("FAKE-Q0");
    expect(resolution?.outcome).toBe("yes");
  });

  it("returns null resolution before the scripted settle time", async () => {
    registerFakeMarket(
      buildFakeMarket({
        venueMarketId: "FAKE-Q1",
        resolution: { at: new Date(Date.now() + 60_000), outcome: "no" },
      })
    );
    const resolution = await fakeAdapter.getResolution("FAKE-Q1");
    expect(resolution).toBeNull();
  });

  it("returns null price with no price walk in the past", async () => {
    registerFakeMarket(
      buildFakeMarket({
        venueMarketId: "FAKE-Q2",
        priceWalk: [{ at: new Date(Date.now() + 60_000), priceYes: 0.5 }],
      })
    );
    const price = await fakeAdapter.getPrice("FAKE-Q2");
    expect(price).toBeNull();
  });
});
