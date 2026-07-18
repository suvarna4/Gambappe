import { describe, it, expect } from "vitest";
import { publicQuestion, publicPick, type QuestionRow, type PickRow } from "./serialize";

function baseQuestion(status: QuestionRow["status"]): QuestionRow {
  return {
    id: "q1",
    kind: "daily",
    headline: "Will it happen?",
    yesLabel: "Yes",
    noLabel: "No",
    category: "sports",
    status,
    opensAt: new Date("2026-07-18T13:00:00Z"),
    locksAt: new Date("2026-07-18T16:00:00Z"),
    revealAt: new Date("2026-07-19T01:00:00Z"),
    revealedAt: status === "revealed" ? new Date("2026-07-19T01:00:00Z") : null,
    crowdYes: 5,
    crowdNo: 3,
    crowdYesAtLock: 4,
    crowdNoAtLock: 3,
    priceYesAtLock: "0.61",
    priceYesAtSettle: "0.63",
    venueUrl: "https://kalshi.com/markets/x",
    priceYes: "0.6",
    priceUpdatedAt: new Date("2026-07-18T14:00:00Z"),
    outcome: "yes",
  };
}

describe("publicQuestion status-matrix (INV-6, D-16)", () => {
  it("open: shows live price, never the split, never the outcome", () => {
    const out = publicQuestion(baseQuestion("open")) as Record<string, unknown>;
    expect(out.priceYes).toBe(0.6);
    expect(out.crowdYesAtLock).toBeUndefined();
    expect(out.crowdNoAtLock).toBeUndefined();
    expect(out.outcome).toBeUndefined();
    expect(out.revealAt).toBeUndefined();
    expect(out.participantCount).toBe(8); // total only, never the split
  });

  it("locked: shows the lock snapshot, never the outcome", () => {
    const out = publicQuestion(baseQuestion("locked")) as Record<string, unknown>;
    expect(out.crowdYesAtLock).toBe(4);
    expect(out.crowdNoAtLock).toBe(3);
    expect(out.priceYesAtLock).toBe(0.61);
    expect(out.outcome).toBeUndefined();
    expect(out.priceYes).toBeUndefined(); // live price only shown pre-lock
  });

  it("graded: shows lock snapshot + revealAt countdown, STILL never the outcome (the leak this fixes)", () => {
    const out = publicQuestion(baseQuestion("graded")) as Record<string, unknown>;
    expect(out.revealAt).toBeDefined();
    expect(out.outcome).toBeUndefined();
    expect(out.priceYesAtSettle).toBeUndefined();
    expect(out.revealedAt).toBeUndefined();
  });

  it("revealed: shows the outcome and settle price", () => {
    const out = publicQuestion(baseQuestion("revealed")) as Record<string, unknown>;
    expect(out.outcome).toBe("yes");
    expect(out.priceYesAtSettle).toBe(0.63);
    expect(out.revealedAt).toBeDefined();
  });

  it("never emits keys outside the §8.1 allowlist for any status", () => {
    const allowed = new Set([
      "id", "kind", "headline", "yesLabel", "noLabel", "category", "status",
      "opensAt", "locksAt", "venueUrl", "participantCount",
      "priceYes", "priceAsOf",
      "crowdYesAtLock", "crowdNoAtLock", "priceYesAtLock",
      "revealAt",
      "outcome", "priceYesAtSettle", "revealedAt",
    ]);
    for (const status of ["draft", "open", "locked", "graded", "revealed", "voided"] as const) {
      const out = publicQuestion(baseQuestion(status));
      for (const key of Object.keys(out)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });
});

describe("publicPick status-matrix (D-16)", () => {
  const pick: PickRow = {
    handle: "fox-4821",
    side: "yes",
    entryPrice: "0.63",
    pickedAt: new Date(),
    result: "win",
  };

  it("returns null entirely pre-lock (open) — no side, no entry, nothing", () => {
    expect(publicPick(pick, "open")).toBeNull();
  });

  it("shows side/entry/pickedAt once locked, but never result", () => {
    const out = publicPick(pick, "locked") as Record<string, unknown>;
    expect(out.side).toBe("yes");
    expect(out.entryPrice).toBe(0.63);
    expect(out.result).toBeUndefined();
  });

  it("still hides result while merely graded", () => {
    const out = publicPick(pick, "graded") as Record<string, unknown>;
    expect(out.result).toBeUndefined();
  });

  it("shows result once revealed", () => {
    const out = publicPick(pick, "revealed") as Record<string, unknown>;
    expect(out.result).toBe("win");
  });
});
