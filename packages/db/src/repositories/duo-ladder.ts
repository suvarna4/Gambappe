/**
 * Duo ladder season repository helpers (design doc §5.4 `seasons`, §8.10, WS6-T3). Thin DB
 * primitives only — the actual promotion/relegation math (`computeLadderMovements`) is a pure
 * function in `@receipts/engine`'s `duo-ladder.ts`; the caller
 * (`apps/worker/src/jobs/duo-window-roll.ts`) loads standings via `listDuoSeasonStandings`,
 * calls the pure function, then persists the result via `applyDuoTierMovements`.
 *
 * `SeasonRow`/`insertSeason` are reused from `./nemesis.js` (WS5-T1), which already declared the
 * generic (any `season_kind`) row type + insert helper for its own `nemesis` season bootstrap —
 * both are `kind`-agnostic already, so redeclaring them here for `kind: 'duo'` would be a real
 * `export *` ambiguous-symbol collision (the exact hazard this repo's cross-agent notes warn
 * about), not a meaningful new type. Only imported for this file's own use, not re-exported —
 * `index.ts`'s existing `export * from './repositories/nemesis.js'` already makes both available
 * to callers.
 */
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../client.js';
import { duoMatches, duos, seasons } from '../schema/index.js';
import type { SeasonRow } from './nemesis.js';

/** The `duo` season (if any) whose `[starts_on, ends_on]` covers `dateStr` (YYYY-MM-DD).
 * Mirrors `nemesis.ts`'s `getNemesisSeasonCoveringDate` one `kind` over. */
export async function getDuoSeasonCoveringDate(db: Db, dateStr: string): Promise<SeasonRow | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.kind, 'duo'), lte(seasons.startsOn, dateStr), gte(seasons.endsOn, dateStr)))
    .orderBy(asc(seasons.startsOn))
    .limit(1);
  return row ?? null;
}

/** The most recently-dated `duo` season (by `ends_on`), regardless of whether it still covers
 * today — i.e. the season `duo:window-roll` should score/conclude when a NEW season is about to
 * be created because none currently covers the window. Null only on the very first-ever
 * `duo:window-roll` run (no `duo` season exists yet — nothing to conclude, bootstrap only). */
export async function getMostRecentDuoSeason(db: Db): Promise<SeasonRow | null> {
  const [row] = await db.select().from(seasons).where(eq(seasons.kind, 'duo')).orderBy(desc(seasons.endsOn)).limit(1);
  return row ?? null;
}

export interface DuoSeasonStanding {
  duoId: string;
  tier: number;
  rating: number;
  /** Completed `duo_matches` this duo won whose window falls entirely within
   * `[seasonStartsOn, seasonEndsOn]` (§8.10 "top ... by match wins ... within tier at each
   * ... season end" — scoped to the ending season, not lifetime). */
  wins: number;
}

/**
 * Every currently-`active` duo's tier/rating plus its win count for the given season window
 * (§8.10 promotion/relegation input). A duo with zero matches in the window still appears with
 * `wins: 0` — it's still a ladder member and still eligible to be ranked (and, in a very sparse
 * tier, to be relegated for inactivity), just like a nemesis leftover isn't dropped from the pool
 * for having no game. Disbanded duos are excluded — nothing to promote/relegate for a duo that no
 * longer exists as a ladder entry.
 */
export async function listDuoSeasonStandings(
  db: Db,
  seasonStartsOn: string,
  seasonEndsOn: string,
): Promise<DuoSeasonStanding[]> {
  const activeDuos = await db
    .select({ id: duos.id, tier: duos.tier, rating: duos.glickoRating })
    .from(duos)
    .where(eq(duos.status, 'active'));
  if (activeDuos.length === 0) return [];

  const wonMatches = await db
    .select({ winnerDuoId: duoMatches.winnerDuoId })
    .from(duoMatches)
    .where(
      and(
        eq(duoMatches.status, 'completed'),
        gte(duoMatches.windowStart, seasonStartsOn),
        lte(duoMatches.windowEnd, seasonEndsOn),
      ),
    );

  const winsByDuoId = new Map<string, number>();
  for (const m of wonMatches) {
    if (!m.winnerDuoId) continue; // draw — no winner to credit
    winsByDuoId.set(m.winnerDuoId, (winsByDuoId.get(m.winnerDuoId) ?? 0) + 1);
  }

  return activeDuos.map((d) => ({
    duoId: d.id,
    tier: d.tier,
    rating: d.rating,
    wins: winsByDuoId.get(d.id) ?? 0,
  }));
}

export interface DuoTierMovementInput {
  duoId: string;
  toTier: number;
}

/** Persists `@receipts/engine`'s `computeLadderMovements` output (§8.10). One UPDATE per duo —
 * movement counts are bounded by `LADDER_PROMOTE_PCT`/`LADDER_RELEGATE_PCT` (20% each) of the
 * (MVP-scale) ladder, so this never needs to be a bulk statement. */
export async function applyDuoTierMovements(
  db: Db,
  movements: readonly DuoTierMovementInput[],
  at: Date,
): Promise<void> {
  for (const movement of movements) {
    await db.update(duos).set({ tier: movement.toTier, updatedAt: at }).where(eq(duos.id, movement.duoId));
  }
}
