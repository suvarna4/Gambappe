/**
 * Duo matchmaking (design doc §8.5). Two pure functions: partner matching for the duo queue,
 * and duo-vs-duo pairing within a ladder tier at window roll. No DB, no clock reads.
 */
import { DUO_BAND_BASE, DUO_BAND_CAP, DUO_BAND_WIDEN } from '@receipts/core';
import { complementarity } from './style.js';
import type { StyleInputs } from './style.js';

/** One profile eligible for duo partnering (§8.5). */
export interface DuoQueueCandidate extends Pick<StyleInputs, 'chalk' | 'categoryShares'> {
  profileId: string;
  rating: number;
  /**
   * Profiles this candidate may not be paired with right now: blocks (both directions) plus
   * prior partners not yet eligible for a repeat (only once BOTH have re-queued since disband,
   * §8.5 — the "since disband" bookkeeping happens upstream; this fn just takes the resulting
   * set).
   */
  excludedPartnerIds: ReadonlySet<string>;
}

export interface DuoWaitingEntry extends DuoQueueCandidate {
  waitSeconds: number;
}

export interface DuoPartnerMatch {
  partnerId: string;
  complementarity: number;
}

/** `DUO_BAND_BASE + DUO_BAND_WIDEN·floor(wait_s/30)`, capped at `DUO_BAND_CAP` (§8.5). */
export function duoRatingBand(waitSeconds: number): number {
  const widened = DUO_BAND_BASE + DUO_BAND_WIDEN * Math.floor(waitSeconds / 30);
  return Math.min(widened, DUO_BAND_CAP);
}

function excludes(a: { profileId: string; excludedPartnerIds: ReadonlySet<string> }, bId: string): boolean {
  return a.excludedPartnerIds.has(bId);
}

/**
 * Best-complementarity partner for the longest-waiting queue entry (§8.5, `duo:matchmaker`
 * 30s tick). Returns null if no candidate is eligible.
 */
export function matchDuoPartner(
  waiting: DuoWaitingEntry,
  candidates: readonly DuoQueueCandidate[],
): DuoPartnerMatch | null {
  const band = duoRatingBand(waiting.waitSeconds);

  let best: DuoPartnerMatch | null = null;
  const sorted = candidates.slice().sort((x, y) => (x.profileId < y.profileId ? -1 : x.profileId > y.profileId ? 1 : 0));
  for (const candidate of sorted) {
    if (candidate.profileId === waiting.profileId) continue;
    if (Math.abs(candidate.rating - waiting.rating) > band) continue;
    if (excludes(waiting, candidate.profileId) || excludes(candidate, waiting.profileId)) continue;

    const score = complementarity(waiting, candidate);
    if (!best || score > best.complementarity) {
      best = { partnerId: candidate.profileId, complementarity: score };
    }
  }
  return best;
}

/** One active duo's team rating for duo-vs-duo pairing (§8.5). */
export interface DuoTeam {
  duoId: string;
  rating: number;
  tier: number;
  /**
   * §8.10 (WS6-T3): `duos.matchmaking_priority` — true when this duo sat out the previous
   * window and should get first claim on a spot this run. Optional/defaults to falsy so every
   * pre-WS6-T3 caller (and this file's own pre-existing tests) keeps its exact prior behavior
   * unchanged when the field is simply omitted.
   */
  matchmakingPriority?: boolean;
}

export interface DuoVsDuoPairing {
  duoAId: string;
  duoBId: string;
}

export interface DuoVsDuoResult {
  pairings: DuoVsDuoPairing[];
  /** Duo ids that sat out this window (odd one out per tier) — caller flags priority-next. */
  oddOneOut: string[];
}

/**
 * Odd-duo-out selection for one tier's rating-sorted list (§8.10 "odd-duo sit-out priority"):
 * prefers to sit out a duo that does NOT carry `matchmakingPriority` (i.e., didn't already sit
 * out last time) — among those, the highest-rated, mirroring the plain-adjacent-pairing rule
 * this replaces (SPEC-GAP(ws6-t2) in `apps/worker/src/jobs/duo-window-roll.ts`'s file header:
 * "the actual priority mechanic ... left for that [WS6-T3] PR"). If every duo in the tier
 * already carries priority (every one sat out before — the leftover-of-leftovers edge case),
 * falls back to the same highest-rated rule since there's no way to satisfy everyone.
 */
function selectSitOut(sorted: readonly DuoTeam[]): DuoTeam {
  const nonPriority = sorted.filter((d) => !d.matchmakingPriority);
  const pool = nonPriority.length > 0 ? nonPriority : sorted;
  return pool.reduce((highest, candidate) => (candidate.rating > highest.rating ? candidate : highest));
}

/**
 * Duo-vs-duo pairing at window roll (§8.5): within each tier, sort by team rating and pair
 * adjacent entries (closest-rating greedy); an odd tier size sits one duo out, preferring a duo
 * without §8.10's sit-out priority flag (`selectSitOut` above).
 */
export function matchDuoVsDuo(duos: readonly DuoTeam[]): DuoVsDuoResult {
  const byTier = new Map<number, DuoTeam[]>();
  for (const duo of duos) {
    const list = byTier.get(duo.tier);
    if (list) list.push(duo);
    else byTier.set(duo.tier, [duo]);
  }

  const pairings: DuoVsDuoPairing[] = [];
  const oddOneOut: string[] = [];

  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (const tier of tiers) {
    const list = byTier.get(tier);
    if (!list) continue;
    let sorted = list
      .slice()
      .sort((x, y) => (x.rating !== y.rating ? x.rating - y.rating : x.duoId < y.duoId ? -1 : x.duoId > y.duoId ? 1 : 0));

    if (sorted.length % 2 === 1) {
      const sitOut = selectSitOut(sorted);
      oddOneOut.push(sitOut.duoId);
      sorted = sorted.filter((d) => d.duoId !== sitOut.duoId);
    }

    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (!a || !b) continue;
      const [duoAId, duoBId] = a.duoId < b.duoId ? [a.duoId, b.duoId] : [b.duoId, a.duoId];
      pairings.push({ duoAId, duoBId });
    }
  }

  return { pairings, oddOneOut };
}
