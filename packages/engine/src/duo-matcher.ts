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
 * Duo-vs-duo pairing at window roll (§8.5): within each tier, sort by team rating and pair
 * adjacent entries (closest-rating greedy); an odd tier size sits one duo out.
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
    const sorted = list
      .slice()
      .sort((x, y) => (x.rating !== y.rating ? x.rating - y.rating : x.duoId < y.duoId ? -1 : x.duoId > y.duoId ? 1 : 0));

    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (!a || !b) continue;
      const [duoAId, duoBId] = a.duoId < b.duoId ? [a.duoId, b.duoId] : [b.duoId, a.duoId];
      pairings.push({ duoAId, duoBId });
    }
    if (sorted.length % 2 === 1) {
      const last = sorted[sorted.length - 1];
      if (last) oddOneOut.push(last.duoId);
    }
  }

  return { pairings, oddOneOut };
}
