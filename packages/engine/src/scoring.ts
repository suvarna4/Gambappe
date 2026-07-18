/**
 * Nemesis week + duo match scoring, and duo chemistry/synergy (design doc §8.8–8.9). Pure
 * functions — no DB, no clock reads (verdict/settlement timing is the caller's concern).
 */
import { SYNERGY_MIN_PICKS } from '@receipts/core';

const EDGE_DRAW_EPSILON = 1e-4;

/** One side's pick outcome on a shared/match question, if they picked at all. */
export interface PlayerQuestionPick {
  picked: boolean;
  /** Required (and meaningful) only when `picked` is true. */
  won: boolean;
  /** Required (and meaningful) only when `picked` is true. */
  edge: number;
}

// --- Nemesis week scoring (§8.8) --------------------------------------------------------------

export interface NemesisSharedQuestion {
  questionId: string;
  /** Voided by settlement. */
  isVoid: boolean;
  /** False if the question is still unsettled at `nemesis:conclude` time. */
  isSettled: boolean;
  profileA: PlayerQuestionPick;
  profileB: PlayerQuestionPick;
}

export interface NemesisWeekScore {
  scoreA: number;
  scoreB: number;
  edgeA: number;
  edgeB: number;
  winner: 'a' | 'b' | 'draw';
  /** Question ids excluded for being void or unsettled by verdict time (§8.8). */
  excludedQuestionIds: string[];
}

/**
 * Per shared graded question: 1 point iff picked AND won (§8.8). Voided/unsettled questions are
 * excluded. Winner = higher score; tie → higher Σ edge over shared picks; `|Δedge| < 1e-4` →
 * draw.
 */
export function scoreNemesisWeek(questions: readonly NemesisSharedQuestion[]): NemesisWeekScore {
  let scoreA = 0;
  let scoreB = 0;
  let edgeA = 0;
  let edgeB = 0;
  const excludedQuestionIds: string[] = [];

  for (const q of questions) {
    if (q.isVoid || !q.isSettled) {
      excludedQuestionIds.push(q.questionId);
      continue;
    }
    if (q.profileA.picked) {
      if (q.profileA.won) scoreA += 1;
      edgeA += q.profileA.edge;
    }
    if (q.profileB.picked) {
      if (q.profileB.won) scoreB += 1;
      edgeB += q.profileB.edge;
    }
  }

  const winner = resolveWinner(scoreA, scoreB, edgeA, edgeB);
  return { scoreA, scoreB, edgeA, edgeB, winner, excludedQuestionIds };
}

function resolveWinner(scoreA: number, scoreB: number, edgeA: number, edgeB: number): 'a' | 'b' | 'draw' {
  if (scoreA !== scoreB) return scoreA > scoreB ? 'a' : 'b';
  const deltaEdge = edgeA - edgeB;
  if (Math.abs(deltaEdge) < EDGE_DRAW_EPSILON) return 'draw';
  return deltaEdge > 0 ? 'a' : 'b';
}

// --- Duo match scoring (§8.9) ------------------------------------------------------------------

export interface DuoSidePicks {
  partner1: PlayerQuestionPick;
  partner2: PlayerQuestionPick;
}

export interface DuoMatchQuestion {
  questionId: string;
  isVoid: boolean;
  isSettled: boolean;
  duoA: DuoSidePicks;
  duoB: DuoSidePicks;
}

export interface DuoMatchScore {
  scoreA: number;
  scoreB: number;
  edgeA: number;
  edgeB: number;
  winner: 'a' | 'b' | 'draw';
  excludedQuestionIds: string[];
}

function duoQuestionPoints(side: DuoSidePicks): number {
  let points = 0;
  if (side.partner1.picked && side.partner1.won) points += 1;
  if (side.partner2.picked && side.partner2.won) points += 1;
  return points;
}

function duoQuestionEdge(side: DuoSidePicks): number {
  let edge = 0;
  if (side.partner1.picked) edge += side.partner1.edge;
  if (side.partner2.picked) edge += side.partner2.edge;
  return edge;
}

/**
 * Per match question: duo points = partners who both picked and won (0–2, §8.9). Winner =
 * higher total; tie → higher Σ edge over the duo's own picks; `|Δedge| < 1e-4` → draw. Void /
 * unsettled questions are excluded, mirroring nemesis week scoring.
 */
export function scoreDuoMatch(questions: readonly DuoMatchQuestion[]): DuoMatchScore {
  let scoreA = 0;
  let scoreB = 0;
  let edgeA = 0;
  let edgeB = 0;
  const excludedQuestionIds: string[] = [];

  for (const q of questions) {
    if (q.isVoid || !q.isSettled) {
      excludedQuestionIds.push(q.questionId);
      continue;
    }
    scoreA += duoQuestionPoints(q.duoA);
    scoreB += duoQuestionPoints(q.duoB);
    edgeA += duoQuestionEdge(q.duoA);
    edgeB += duoQuestionEdge(q.duoB);
  }

  const winner = resolveWinner(scoreA, scoreB, edgeA, edgeB);
  return { scoreA, scoreB, edgeA, edgeB, winner, excludedQuestionIds };
}

// --- Duo chemistry / synergy (§8.9) -------------------------------------------------------------

/**
 * A "slot" = one (partner, question) pair where that partner placed a graded win/loss pick on a
 * duo-match question. Missing picks and voids create no slot (§8.9).
 */
export interface DuoSlot {
  won: boolean;
}

export interface DuoSynergyInput {
  slots: readonly DuoSlot[];
  /** Lifetime accuracy of each partner at computation time. */
  partnerAAccuracy: number;
  partnerBAccuracy: number;
}

export interface DuoSynergyResult {
  jointHitRate: number;
  expected: number;
  /** `joint_hit_rate − expected`; null until `slots.length >= SYNERGY_MIN_PICKS` (§8.9). */
  synergy: number | null;
  totalSlots: number;
}

/**
 * `joint_hit_rate = winning slots / total slots`, `expected = mean(lifetime accuracy)`,
 * `synergy = joint − expected`, gated on `SYNERGY_MIN_PICKS` (12) total slots (§8.9).
 */
export function computeDuoSynergy(input: DuoSynergyInput): DuoSynergyResult {
  const totalSlots = input.slots.length;
  const winningSlots = input.slots.filter((s) => s.won).length;
  const jointHitRate = totalSlots > 0 ? winningSlots / totalSlots : 0;
  const expected = (input.partnerAAccuracy + input.partnerBAccuracy) / 2;
  const synergy = totalSlots >= SYNERGY_MIN_PICKS ? jointHitRate - expected : null;
  return { jointHitRate, expected, synergy, totalSlots };
}
