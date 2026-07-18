import { describe, it, expect } from "vitest";
import {
  narrateAssigned,
  narrateLastChance,
  narrateVerdictWinner,
  narrateVerdictLoser,
  type NemesisNarrationContext,
} from "./narration";

const ctx: NemesisNarrationContext = {
  pairingId: "pairing-1",
  handleA: "fox-4821",
  handleB: "owl-1123",
  scoreA: 2,
  scoreB: 1,
  questionsRemaining: 1,
};

const MONEY_REGEX = /\$|USD|dollar|bet more|deposit|wager|cash/i;

describe("narration templates", () => {
  it("every trigger is reachable and produces headline + body", () => {
    const results = [
      narrateAssigned(ctx),
      narrateLastChance(ctx),
      narrateVerdictWinner(ctx, ctx.handleA),
      narrateVerdictLoser(ctx, ctx.handleB),
    ];
    for (const r of results) {
      expect(r.headline.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });

  it("rotates deterministically by pairing id (same id -> same variant)", () => {
    const a = narrateAssigned(ctx);
    const b = narrateAssigned({ ...ctx });
    expect(a).toEqual(b);
  });

  it("different pairing ids can select different variants", () => {
    const variants = new Set<string>();
    for (let i = 0; i < 20; i++) {
      variants.add(narrateAssigned({ ...ctx, pairingId: `pairing-${i}` }).headline);
    }
    expect(variants.size).toBeGreaterThan(1);
  });

  it("INV-8: no template ever mentions money, betting amounts, or stake size", () => {
    const allContexts: NemesisNarrationContext[] = Array.from({ length: 10 }, (_, i) => ({
      ...ctx,
      pairingId: `p${i}`,
    }));
    for (const c of allContexts) {
      const outputs = [
        narrateAssigned(c),
        narrateLastChance(c),
        narrateVerdictWinner(c, c.handleA),
        narrateVerdictLoser(c, c.handleB),
      ];
      for (const o of outputs) {
        expect(o.headline).not.toMatch(MONEY_REGEX);
        expect(o.body).not.toMatch(MONEY_REGEX);
      }
    }
  });
});
