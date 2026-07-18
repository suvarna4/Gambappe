import { describe, it, expect } from "vitest";
import { matchNemeses, type NemesisCandidate } from "./nemesis-lite";

describe("matchNemeses (§16.5)", () => {
  it("pairs two candidates within the accuracy band, maximizing chalk contrast", () => {
    const candidates: NemesisCandidate[] = [
      { userId: "chalk-lover", accuracy: 0.6, chalk: 0.85 },
      { userId: "longshot-chaser", accuracy: 0.6, chalk: 0.2 },
    ];
    const pairs = matchNemeses(candidates);
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].userA, pairs[0].userB])).toEqual(
      new Set(["chalk-lover", "longshot-chaser"])
    );
  });

  it("never pairs across the accuracy band (fairness property, P12)", () => {
    for (let trial = 0; trial < 50; trial++) {
      const pool: NemesisCandidate[] = Array.from({ length: 10 }, (_, i) => ({
        userId: `u${i}`,
        accuracy: Math.random(),
        chalk: Math.random(),
      }));
      const byId = new Map(pool.map((c) => [c.userId, c]));
      const pairs = matchNemeses(pool);
      for (const p of pairs) {
        const a = byId.get(p.userA)!;
        const b = byId.get(p.userB)!;
        expect(Math.abs(a.accuracy - b.accuracy)).toBeLessThanOrEqual(0.15 + 1e-9);
      }
    }
  });

  it("never double-books a candidate into two pairs", () => {
    const pool: NemesisCandidate[] = Array.from({ length: 8 }, (_, i) => ({
      userId: `u${i}`,
      accuracy: 0.5, // all in-band with each other
      chalk: i / 8,
    }));
    const pairs = matchNemeses(pool);
    const seen = new Set<string>();
    for (const p of pairs) {
      expect(seen.has(p.userA)).toBe(false);
      expect(seen.has(p.userB)).toBe(false);
      seen.add(p.userA);
      seen.add(p.userB);
    }
    expect(pairs).toHaveLength(4);
  });

  it("leaves an out-of-band candidate unmatched rather than relaxing fairness", () => {
    const pool: NemesisCandidate[] = [
      { userId: "a", accuracy: 0.5, chalk: 0.3 },
      { userId: "b", accuracy: 0.5, chalk: 0.7 },
      { userId: "outlier", accuracy: 0.99, chalk: 0.5 },
    ];
    const pairs = matchNemeses(pool);
    const paired = new Set(pairs.flatMap((p) => [p.userA, p.userB]));
    expect(paired.has("outlier")).toBe(false);
  });
});
