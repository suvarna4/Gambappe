import { CONSTANTS } from "@/shared/constants";

export interface NemesisCandidate {
  userId: string;
  accuracy: number; // trailing accuracy, 0..1
  chalk: number; // mean entry price of chosen sides, 0..1
}

export interface NemesisPairResult {
  userA: string;
  userB: string;
}

/**
 * §16.5 nemesis-lite matcher (pure). Band by trailing accuracy
 * ±NEMESIS_RATING_BAND (fair fights, P12), then within the eligible
 * edges maximize |chalk_a - chalk_b| (style contrast), greedy.
 * Unmatched leftovers stay unmatched rather than relaxing fairness
 * (P12: "never relax fairness").
 */
export function matchNemeses(
  candidates: NemesisCandidate[],
  band: number = CONSTANTS.NEMESIS_RATING_BAND
): NemesisPairResult[] {
  type Edge = { a: string; b: string; weight: number };
  const edges: Edge[] = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const u = candidates[i];
      const v = candidates[j];
      if (Math.abs(u.accuracy - v.accuracy) > band) continue;
      edges.push({ a: u.userId, b: v.userId, weight: Math.abs(u.chalk - v.chalk) });
    }
  }

  edges.sort((x, y) => y.weight - x.weight);

  const matched = new Set<string>();
  const pairs: NemesisPairResult[] = [];
  for (const e of edges) {
    if (matched.has(e.a) || matched.has(e.b)) continue;
    matched.add(e.a);
    matched.add(e.b);
    pairs.push({ userA: e.a, userB: e.b });
  }

  return pairs;
}
