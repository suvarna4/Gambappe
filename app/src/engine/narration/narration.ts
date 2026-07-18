/**
 * §7.11.5 narration templates — deterministic, no LLM. Pure functions:
 * (context) -> { headline, body }. Rotated deterministically by a hash of
 * the pairing id, not RNG (reproducible for a given matchup). MVP keeps
 * the 3 triggers named in §16.5: assigned, last_chance, verdict (winner
 * + loser variants).
 */

export interface NemesisNarrationContext {
  pairingId: string;
  handleA: string;
  handleB: string;
  scoreA: number;
  scoreB: number;
  questionsRemaining: number;
}

export interface Narration {
  headline: string;
  body: string;
}

function hashPick(seed: string, variantCount: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % variantCount;
}

const ASSIGNED_VARIANTS: ((c: NemesisNarrationContext) => Narration)[] = [
  (c) => ({
    headline: "Meet your nemesis.",
    body: `${c.handleA} vs ${c.handleB}. Two strangers. Same markets. Only one gets the receipt.`,
  }),
  (c) => ({
    headline: "The pairing is set.",
    body: `${c.handleA} and ${c.handleB} were matched for one reason: neither of you picks like the other.`,
  }),
];

const LAST_CHANCE_VARIANTS: ((c: NemesisNarrationContext) => Narration)[] = [
  (c) => ({
    headline: "Last chance.",
    body: `One question left. ${c.scoreA > c.scoreB ? c.handleB : c.handleA} needs it to survive the week.`,
  }),
  (c) => ({
    headline: "Down to the wire.",
    body: `Final question of the week. The score is ${c.scoreA}-${c.scoreB}. Everything's live.`,
  }),
];

const VERDICT_WINNER_VARIANTS: ((c: NemesisNarrationContext, winnerHandle: string) => Narration)[] = [
  (c, w) => ({
    headline: `${w} takes the week.`,
    body: `Final score: ${c.scoreA}-${c.scoreB}. The receipt is stamped.`,
  }),
  (c, w) => ({
    headline: `${w} called it better.`,
    body: `A cleaner week, question for question: ${c.scoreA}-${c.scoreB}.`,
  }),
];

const VERDICT_LOSER_VARIANTS: ((c: NemesisNarrationContext, loserHandle: string) => Narration)[] = [
  (c, l) => ({
    headline: `${l} takes the loss.`,
    body: `${c.scoreA}-${c.scoreB} this week. The receipt doesn't lie — there's always next week.`,
  }),
  (c, l) => ({
    headline: `Not ${l}'s week.`,
    body: `Final: ${c.scoreA}-${c.scoreB}. Losing publicly, with style, is the whole point.`,
  }),
];

export function narrateAssigned(ctx: NemesisNarrationContext): Narration {
  const variant = ASSIGNED_VARIANTS[hashPick(ctx.pairingId + ":assigned", ASSIGNED_VARIANTS.length)];
  return variant(ctx);
}

export function narrateLastChance(ctx: NemesisNarrationContext): Narration {
  const variant = LAST_CHANCE_VARIANTS[hashPick(ctx.pairingId + ":last_chance", LAST_CHANCE_VARIANTS.length)];
  return variant(ctx);
}

export function narrateVerdictWinner(ctx: NemesisNarrationContext, winnerHandle: string): Narration {
  const variant =
    VERDICT_WINNER_VARIANTS[hashPick(ctx.pairingId + ":verdict:w", VERDICT_WINNER_VARIANTS.length)];
  return variant(ctx, winnerHandle);
}

export function narrateVerdictLoser(ctx: NemesisNarrationContext, loserHandle: string): Narration {
  const variant =
    VERDICT_LOSER_VARIANTS[hashPick(ctx.pairingId + ":verdict:l", VERDICT_LOSER_VARIANTS.length)];
  return variant(ctx, loserHandle);
}

/** Picks the trigger for the "current beat" shown on the matchup page. */
export function narrateCurrentBeat(
  ctx: NemesisNarrationContext,
  status: "active" | "completed",
  winnerHandle?: string,
  loserHandle?: string
): Narration {
  if (status === "completed" && winnerHandle && loserHandle) {
    return narrateVerdictWinner(ctx, winnerHandle);
  }
  if (ctx.questionsRemaining <= 1) return narrateLastChance(ctx);
  return narrateAssigned(ctx);
}
