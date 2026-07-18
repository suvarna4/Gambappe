/**
 * Duo ladder promotion/relegation (design doc §8.10, WS6-T3). Pure function — no DB, no clock
 * reads; the caller (`apps/worker/src/jobs/duo-window-roll.ts`) resolves the ended season's
 * per-duo win counts and current tier/rating, calls this, then persists the returned movements.
 *
 * §8.10: "Promotion: top LADDER_PROMOTE_PCT (20%) of duos by match wins then rating within tier
 * at each DUO_SEASON_WEEKS (4)-week duo season end; relegation bottom LADDER_RELEGATE_PCT (20%).
 * New duos enter tier 1." Tiers are 1..LADDER_TIERS (5); `duos.tier` already defaults new duos to
 * 1 (packages/db/src/schema/modes.ts) — this function only ever computes MOVEMENT for existing
 * duos, never initial placement.
 *
 * SPEC-GAP(ws6-t3): §8.10 doesn't pin a rounding rule for "top/bottom 20%" against tier sizes
 * that aren't multiples of 5. This function uses `Math.floor(n * pct)` — i.e. a tier never moves
 * MORE than its literal percentage (a tier of 4 promotes 0, not 1; a tier of 5 promotes exactly
 * 1) — the same "never exceed the stated fraction" reading used nowhere else in this doc but
 * consistent with how §8.6's percentile/§6.6 streak math round conservatively elsewhere. A
 * genuine product call could reasonably round instead; flagged here and in the PR description
 * since no test/copy in the doc pins the choice either way.
 */
import { LADDER_PROMOTE_PCT, LADDER_RELEGATE_PCT, LADDER_TIERS } from '@receipts/core';

/** One duo's standing within its current tier at duo-season end (§8.10 sort key: wins desc,
 * then rating desc). `wins` = completed duo_matches this duo won during the ending season only
 * (not lifetime) — the caller scopes the query to the season's date range. */
export interface DuoLadderStanding {
  duoId: string;
  tier: number;
  rating: number;
  wins: number;
}

export interface DuoLadderMovement {
  duoId: string;
  fromTier: number;
  toTier: number;
  direction: 'promoted' | 'relegated';
}

function rank(standings: readonly DuoLadderStanding[]): DuoLadderStanding[] {
  return standings
    .slice()
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.rating !== b.rating) return b.rating - a.rating;
      return a.duoId < b.duoId ? -1 : a.duoId > b.duoId ? 1 : 0; // deterministic tie-break
    });
}

/**
 * Computes tier movements for one duo-season boundary (§8.10), independently per tier. A duo
 * already at the ceiling (`LADDER_TIERS`) that ranks in the top slice, or already at the floor
 * (tier 1) that ranks in the bottom slice, produces NO movement (clamped, nothing to persist) —
 * there's nowhere further to go.
 */
export function computeLadderMovements(standings: readonly DuoLadderStanding[]): DuoLadderMovement[] {
  const byTier = new Map<number, DuoLadderStanding[]>();
  for (const s of standings) {
    const list = byTier.get(s.tier);
    if (list) list.push(s);
    else byTier.set(s.tier, [s]);
  }

  const movements: DuoLadderMovement[] = [];
  const tiers = [...byTier.keys()].sort((a, b) => a - b);

  for (const tier of tiers) {
    const list = byTier.get(tier);
    if (!list) continue;
    const sorted = rank(list);
    const n = sorted.length;
    const promoteCount = Math.floor(n * LADDER_PROMOTE_PCT);
    const relegateCount = Math.floor(n * LADDER_RELEGATE_PCT);

    for (let i = 0; i < promoteCount; i++) {
      const d = sorted[i];
      if (!d) continue;
      const toTier = Math.min(d.tier + 1, LADDER_TIERS);
      if (toTier !== d.tier) {
        movements.push({ duoId: d.duoId, fromTier: d.tier, toTier, direction: 'promoted' });
      }
    }
    for (let i = n - relegateCount; i < n; i++) {
      const d = sorted[i];
      if (!d) continue;
      const toTier = Math.max(d.tier - 1, 1);
      if (toTier !== d.tier) {
        movements.push({ duoId: d.duoId, fromTier: d.tier, toTier, direction: 'relegated' });
      }
    }
  }

  return movements;
}
