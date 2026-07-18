/**
 * Nemesis matchmaking (design doc §8.4). Pure function `matchNemeses(pool, history, constraints)`
 * — no DB, no clock reads. Rematches are placed first and removed from the eligible pool; the
 * remainder is matched by greedy edge selection plus bounded 2-opt improvement.
 */
import {
  MATCHER_2OPT_PASSES,
  NEMESIS_BAND_BASE,
  OVERLAP_FLOOR,
  PRIORITY_BONUS,
  RD_PENALTY,
  TZ_BONUS,
  TZ_BONUS_MAX_OFFSET_H,
} from '@receipts/core';
import type { StyleVector } from '@receipts/core';
import { expectedScore } from './glicko2.js';
import { buildStyleVector, categoryOverlap, styleDistance } from './style.js';
import type { StyleInputs } from './style.js';

/** One eligible profile in the matchmaking pool (§8.4). */
export interface NemesisPoolEntry extends StyleInputs {
  profileId: string;
  rating: number;
  rd: number;
  /** Browser IANA-derived UTC offset in hours; null if unknown (§8.4 TZ_BONUS). */
  utcOffsetHours: number | null;
  /** `profiles.matchmaking_priority` — true for last run's leftovers (§8.4 step 4). */
  matchmakingPriority: boolean;
}

/** An unordered profile-pair key, canonicalized so direction never matters. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Blocked pairs and season-repeat pairs, both direction-agnostic (§8.4 step 1). */
export interface NemesisMatchHistory {
  blockedPairs: ReadonlyArray<readonly [string, string]>;
  pairedThisSeason: ReadonlyArray<readonly [string, string]>;
}

/** A mutually-accepted rematch, decided before this run (§8.4 step 0). */
export interface NemesisForcedPair {
  profileAId: string;
  profileBId: string;
}

export interface NemesisMatchConstraints {
  forcedPairs: readonly NemesisForcedPair[];
}

export interface NemesisPairingResult {
  profileAId: string;
  profileBId: string;
  /** Edge score at match time (§8.4 step 2); 0 for forced/rematch pairs (no candidate scoring). */
  score: number;
  isRematch: boolean;
  /** Glicko expected win probability for profileA over profileB (§8.4 fairness telemetry). */
  expectedScoreA: number;
}

export interface NemesisMatchOutput {
  pairings: NemesisPairingResult[];
  /** Unmatched profile ids — caller sets `matchmaking_priority=true` on these (§8.4 step 4). */
  leftoverProfileIds: string[];
}

function tzBonusApplies(a: NemesisPoolEntry, b: NemesisPoolEntry): boolean {
  if (a.utcOffsetHours === null || b.utcOffsetHours === null) return false;
  return Math.abs(a.utcOffsetHours - b.utcOffsetHours) <= TZ_BONUS_MAX_OFFSET_H;
}

function isEligiblePair(
  a: NemesisPoolEntry,
  b: NemesisPoolEntry,
  blockedKeys: ReadonlySet<string>,
  pairedKeys: ReadonlySet<string>,
): boolean {
  const key = pairKey(a.profileId, b.profileId);
  if (blockedKeys.has(key) || pairedKeys.has(key)) return false;
  const band = Math.max(NEMESIS_BAND_BASE, 0.5 * (a.rd + b.rd));
  if (Math.abs(a.rating - b.rating) > band) return false;
  if (categoryOverlap(a.categoryShares, b.categoryShares) < OVERLAP_FLOOR) return false;
  return true;
}

function edgeScore(a: NemesisPoolEntry, b: NemesisPoolEntry, styleVectorOf: ReadonlyMap<string, StyleVector>): number {
  const va = styleVectorOf.get(a.profileId) ?? buildStyleVector(a);
  const vb = styleVectorOf.get(b.profileId) ?? buildStyleVector(b);
  let score = styleDistance(va, vb) - RD_PENALTY * Math.abs(a.rating - b.rating);
  if (tzBonusApplies(a, b)) score += TZ_BONUS;
  if (a.matchmakingPriority || b.matchmakingPriority) score += PRIORITY_BONUS;
  return score;
}

interface CandidateEdge {
  aId: string;
  bId: string;
  key: string;
  score: number;
}

/**
 * Weekly nemesis matchmaking batch (§8.4). `pool` is the already-filtered eligible set
 * (claimed, active, ≥NEMESIS_MIN_PICKS, bot_score below threshold — that filtering happens
 * upstream of this pure function). Deterministic given the same inputs.
 */
export function matchNemeses(
  pool: readonly NemesisPoolEntry[],
  history: NemesisMatchHistory,
  constraints: NemesisMatchConstraints,
): NemesisMatchOutput {
  const byId = new Map<string, NemesisPoolEntry>();
  for (const entry of pool) byId.set(entry.profileId, entry);

  const forcedIds = new Set<string>();
  const pairings: NemesisPairingResult[] = [];

  for (const forced of constraints.forcedPairs) {
    const a = byId.get(forced.profileAId);
    const b = byId.get(forced.profileBId);
    if (!a || !b) continue; // SPEC-GAP(WS4-T4): forced pair references a profile outside pool — skip rather than crash.
    forcedIds.add(a.profileId);
    forcedIds.add(b.profileId);
    const [profileAId, profileBId] = a.profileId < b.profileId ? [a.profileId, b.profileId] : [b.profileId, a.profileId];
    pairings.push({
      profileAId,
      profileBId,
      score: 0,
      isRematch: true,
      expectedScoreA: expectedScore(a, b),
    });
  }

  const remaining = pool.filter((p) => !forcedIds.has(p.profileId)).slice().sort((x, y) => (x.profileId < y.profileId ? -1 : x.profileId > y.profileId ? 1 : 0));

  const styleVectorOf = new Map<string, StyleVector>();
  for (const p of remaining) styleVectorOf.set(p.profileId, buildStyleVector(p));

  const blockedKeys = new Set(history.blockedPairs.map(([a, b]) => pairKey(a, b)));
  const pairedKeys = new Set(history.pairedThisSeason.map(([a, b]) => pairKey(a, b)));

  const edges: CandidateEdge[] = [];
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const a = remaining[i];
      const b = remaining[j];
      if (!a || !b) continue;
      if (!isEligiblePair(a, b, blockedKeys, pairedKeys)) continue;
      edges.push({
        aId: a.profileId,
        bId: b.profileId,
        key: pairKey(a.profileId, b.profileId),
        score: edgeScore(a, b, styleVectorOf),
      });
    }
  }

  edges.sort((x, y) => (y.score !== x.score ? y.score - x.score : x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  const matchedTo = new Map<string, string>();
  for (const edge of edges) {
    if (matchedTo.has(edge.aId) || matchedTo.has(edge.bId)) continue;
    matchedTo.set(edge.aId, edge.bId);
    matchedTo.set(edge.bId, edge.aId);
  }

  type CurrentPair = { aId: string; bId: string; key: string };
  const currentPairs: CurrentPair[] = [];
  const seen = new Set<string>();
  for (const [aId, bId] of matchedTo) {
    const key = pairKey(aId, bId);
    if (seen.has(key)) continue;
    seen.add(key);
    currentPairs.push({ aId, bId, key });
  }
  currentPairs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  const scoreOf = new Map<string, number>();
  for (const e of edges) scoreOf.set(e.key, e.score);

  for (let pass = 0; pass < MATCHER_2OPT_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < currentPairs.length; i++) {
      for (let j = i + 1; j < currentPairs.length; j++) {
        const p1 = currentPairs[i];
        const p2 = currentPairs[j];
        if (!p1 || !p2) continue;
        const a = byId.get(p1.aId);
        const b = byId.get(p1.bId);
        const c = byId.get(p2.aId);
        const d = byId.get(p2.bId);
        if (!a || !b || !c || !d) continue;

        const currentTotal =
          (scoreOf.get(p1.key) ?? edgeScore(a, b, styleVectorOf)) + (scoreOf.get(p2.key) ?? edgeScore(c, d, styleVectorOf));

        const optionAC_BD = tryImprove(a, c, b, d, currentTotal, blockedKeys, pairedKeys, styleVectorOf);
        const optionAD_BC = tryImprove(a, d, b, c, currentTotal, blockedKeys, pairedKeys, styleVectorOf);

        let best = optionAC_BD;
        if (optionAD_BC && (!best || optionAD_BC.total > best.total)) best = optionAD_BC;

        if (best) {
          const newKey1 = pairKey(best.pair1[0].profileId, best.pair1[1].profileId);
          const newKey2 = pairKey(best.pair2[0].profileId, best.pair2[1].profileId);
          currentPairs[i] = { aId: best.pair1[0].profileId, bId: best.pair1[1].profileId, key: newKey1 };
          currentPairs[j] = { aId: best.pair2[0].profileId, bId: best.pair2[1].profileId, key: newKey2 };
          scoreOf.set(newKey1, best.score1);
          scoreOf.set(newKey2, best.score2);
          currentPairs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  function tryImprove(
    a: NemesisPoolEntry,
    c: NemesisPoolEntry,
    b: NemesisPoolEntry,
    d: NemesisPoolEntry,
    currentTotal: number,
    blocked: ReadonlySet<string>,
    paired: ReadonlySet<string>,
    vectors: ReadonlyMap<string, StyleVector>,
  ): { pair1: [NemesisPoolEntry, NemesisPoolEntry]; pair2: [NemesisPoolEntry, NemesisPoolEntry]; score1: number; score2: number; total: number } | null {
    if (a.profileId === c.profileId || b.profileId === d.profileId) return null;
    if (!isEligiblePair(a, c, blocked, paired) || !isEligiblePair(b, d, blocked, paired)) return null;
    const score1 = edgeScore(a, c, vectors);
    const score2 = edgeScore(b, d, vectors);
    const total = score1 + score2;
    if (total <= currentTotal + 1e-9) return null;
    return { pair1: [a, c], pair2: [b, d], score1, score2, total };
  }

  for (const pair of currentPairs) {
    const a = byId.get(pair.aId);
    const b = byId.get(pair.bId);
    if (!a || !b) continue;
    const [profileAId, profileBId] = a.profileId < b.profileId ? [a.profileId, b.profileId] : [b.profileId, a.profileId];
    pairings.push({
      profileAId,
      profileBId,
      score: scoreOf.get(pair.key) ?? edgeScore(a, b, styleVectorOf),
      isRematch: false,
      expectedScoreA: expectedScore(a, b),
    });
  }

  pairings.sort((x, y) => (x.profileAId < y.profileAId ? -1 : x.profileAId > y.profileAId ? 1 : x.profileBId < y.profileBId ? -1 : x.profileBId > y.profileBId ? 1 : 0));

  const matchedIds = new Set<string>();
  for (const p of pairings) {
    matchedIds.add(p.profileAId);
    matchedIds.add(p.profileBId);
  }
  const leftoverProfileIds = remaining.filter((p) => !matchedIds.has(p.profileId)).map((p) => p.profileId);

  return { pairings, leftoverProfileIds };
}
