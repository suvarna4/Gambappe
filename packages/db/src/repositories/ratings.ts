/**
 * `ratings:weekly` batch queries (design doc §8.3, §6.5, WS4-T7): finds completed-but-unapplied
 * nemesis pairings/duo matches, reads/writes individual + duo team Glicko-2 ratings, and lists
 * the "no game this period" population for RD-only inflation.
 *
 * Per-profile rating read/write (`getOrDefaultRating`/`updateRating`/`incrementGamesCount`)
 * reuses `../repositories/moderation.js`'s exports rather than duplicating them — WS11-T3
 * already built those primitives for its own early-conclusion path (blocking mid-week), which
 * applies ratings through the exact same `updateGlicko2`/`ratings` table outside this batch
 * (and stamps `rating_applied_at` itself, which is exactly what makes this batch's
 * `rating_applied_at IS NULL` filter correctly skip those pairings — see §8.3).
 */
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { duoMatches, duos, nemesisPairings, profiles, ratings } from '../schema/index.js';

// NOTE: `NemesisPairingRow`/`DuoMatchRow` are already exported from `./moderation.js`
// (WS11-T3) as `typeof nemesisPairings.$inferSelect` / `typeof duoMatches.$inferSelect` —
// reused via the `Pairing`/`DuoMatch` shapes below instead of a colliding redeclaration
// (both files are re-exported `export *` from `index.ts`, so two same-named type exports
// would be ambiguous).
export type DuoRow = typeof duos.$inferSelect;

export interface UnappliedPairing {
  id: string;
  seasonId: string;
  weekStart: string;
  profileAId: string;
  profileBId: string;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  scoreA: number;
  scoreB: number;
  edgeA: number;
  edgeB: number;
  winnerProfileId: string | null;
  verdict: unknown;
  isRematch: boolean;
  ratingAppliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  profileAStatus: string;
  profileBStatus: string;
}

/** §8.3 batch input: completed pairings not yet rating-applied (the idempotency guard). Joins
 * both participants' `profiles.status` so the caller can honor "a participant profile is
 * deleted -> skipped entirely, no rating change for the survivor" without a second query. */
export async function listUnappliedCompletedPairings(db: Db): Promise<UnappliedPairing[]> {
  const rows = await db.execute(sql`
    SELECT np.*, pa.status AS profile_a_status, pb.status AS profile_b_status
    FROM nemesis_pairings np
    JOIN profiles pa ON pa.id = np.profile_a_id
    JOIN profiles pb ON pb.id = np.profile_b_id
    WHERE np.status = 'completed' AND np.rating_applied_at IS NULL
  `);
  return rows.rows.map((r) => ({
    id: r['id'] as string,
    seasonId: r['season_id'] as string,
    weekStart: r['week_start'] as string,
    profileAId: r['profile_a_id'] as string,
    profileBId: r['profile_b_id'] as string,
    status: r['status'] as UnappliedPairing['status'],
    scoreA: r['score_a'] as number,
    scoreB: r['score_b'] as number,
    edgeA: Number(r['edge_a']),
    edgeB: Number(r['edge_b']),
    winnerProfileId: r['winner_profile_id'] as string | null,
    verdict: r['verdict'] as unknown,
    isRematch: r['is_rematch'] as boolean,
    ratingAppliedAt: r['rating_applied_at'] ? new Date(r['rating_applied_at'] as string) : null,
    createdAt: new Date(r['created_at'] as string),
    updatedAt: new Date(r['updated_at'] as string),
    profileAStatus: r['profile_a_status'] as string,
    profileBStatus: r['profile_b_status'] as string,
  }));
}

/**
 * Locks ONE pairing row `FOR UPDATE` and confirms it's still an unapplied completed pairing —
 * the per-item re-check inside the processing transaction (mirrors `settlement-poll.ts`'s
 * per-item re-check pattern) that makes a true concurrent double-fire safe, on top of the
 * listing query's own filter already making a sequential re-run a no-op. Only the two fields
 * the caller needs to re-verify are returned; the rest of the row (participants, winner,
 * verdict) was already read by `listUnappliedCompletedPairings` and doesn't change out from
 * under a `status='completed'` pairing.
 */
export async function lockUnappliedPairing(tx: Db, pairingId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT status, rating_applied_at FROM nemesis_pairings WHERE id = ${pairingId} FOR UPDATE
  `);
  const r = rows.rows[0];
  return !!r && r['status'] === 'completed' && r['rating_applied_at'] === null;
}

/** Stamps `rating_applied_at` + merges `rating_before` into the pairing's existing `verdict`
 * JSON (never replacing it — `nemesis:conclude`'s narration bundle, §13.3, lives there too). */
export async function applyPairingRating(
  tx: Db,
  pairingId: string,
  currentVerdict: unknown,
  ratingBefore: {
    a: { rating: number; rd: number; vol: number };
    b: { rating: number; rd: number; vol: number };
  },
  at: Date,
): Promise<void> {
  const verdict = { ...(currentVerdict && typeof currentVerdict === 'object' ? currentVerdict : {}), rating_before: ratingBefore };
  await tx
    .update(nemesisPairings)
    .set({ ratingAppliedAt: at, verdict, updatedAt: at })
    .where(eq(nemesisPairings.id, pairingId));
}

/** Stamps `rating_applied_at` with NO rating change — the "participant profile deleted, skip
 * entirely" branch (§8.3). Still consumes the row so the batch never retries it forever. */
export async function markPairingRatingSkipped(
  tx: Db,
  pairingId: string,
  currentVerdict: unknown,
  reason: string,
  at: Date,
): Promise<void> {
  const verdict = {
    ...(currentVerdict && typeof currentVerdict === 'object' ? currentVerdict : {}),
    rating_skipped_reason: reason,
  };
  await tx
    .update(nemesisPairings)
    .set({ ratingAppliedAt: at, verdict, updatedAt: at })
    .where(eq(nemesisPairings.id, pairingId));
}

// --- Duo matches (§8.3 "duo team ratings updated identically ... in the same batch") ---------

export interface UnappliedDuoMatch {
  id: string;
  duoAId: string;
  duoBId: string;
  windowStart: string;
  windowEnd: string;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  scoreA: number;
  scoreB: number;
  winnerDuoId: string | null;
  ratingAppliedAt: Date | null;
  ratingSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
  duoAStatus: string;
  duoBStatus: string;
}

export async function listUnappliedCompletedDuoMatches(db: Db): Promise<UnappliedDuoMatch[]> {
  const rows = await db.execute(sql`
    SELECT dm.*, da.status AS duo_a_status, dob.status AS duo_b_status
    FROM duo_matches dm
    JOIN duos da ON da.id = dm.duo_a_id
    JOIN duos dob ON dob.id = dm.duo_b_id
    WHERE dm.status = 'completed' AND dm.rating_applied_at IS NULL
  `);
  return rows.rows.map((r) => ({
    id: r['id'] as string,
    duoAId: r['duo_a_id'] as string,
    duoBId: r['duo_b_id'] as string,
    windowStart: r['window_start'] as string,
    windowEnd: r['window_end'] as string,
    status: r['status'] as UnappliedDuoMatch['status'],
    scoreA: r['score_a'] as number,
    scoreB: r['score_b'] as number,
    winnerDuoId: r['winner_duo_id'] as string | null,
    ratingAppliedAt: r['rating_applied_at'] ? new Date(r['rating_applied_at'] as string) : null,
    ratingSnapshot: r['rating_snapshot'] as unknown,
    createdAt: new Date(r['created_at'] as string),
    updatedAt: new Date(r['updated_at'] as string),
    duoAStatus: r['duo_a_status'] as string,
    duoBStatus: r['duo_b_status'] as string,
  }));
}

/** Duo-match analogue of `lockUnappliedPairing` — see its comment. */
export async function lockUnappliedDuoMatch(tx: Db, matchId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT status, rating_applied_at FROM duo_matches WHERE id = ${matchId} FOR UPDATE
  `);
  const r = rows.rows[0];
  return !!r && r['status'] === 'completed' && r['rating_applied_at'] === null;
}

export async function getDuoById(db: Db, duoId: string): Promise<DuoRow | null> {
  const [row] = await db.select().from(duos).where(eq(duos.id, duoId)).limit(1);
  return row ?? null;
}

export async function updateDuoRating(
  db: Db,
  duoId: string,
  rating: { rating: number; rd: number; vol: number },
  at: Date,
): Promise<void> {
  await db
    .update(duos)
    .set({ glickoRating: rating.rating, glickoRd: rating.rd, glickoVol: rating.vol, updatedAt: at })
    .where(eq(duos.id, duoId));
}

export async function incrementDuoMatchesPlayed(db: Db, duoId: string, at: Date): Promise<void> {
  await db
    .update(duos)
    .set({ matchesPlayed: sql`${duos.matchesPlayed} + 1`, updatedAt: at })
    .where(eq(duos.id, duoId));
}

/** Stamps `rating_applied_at` + the dedicated `rating_snapshot` column (§5.5 — duo matches use
 * a plain column here, unlike pairings which nest `rating_before` inside `verdict` jsonb). */
export async function applyDuoMatchRating(
  tx: Db,
  matchId: string,
  ratingSnapshot: {
    a: { rating: number; rd: number; vol: number };
    b: { rating: number; rd: number; vol: number };
  },
  at: Date,
): Promise<void> {
  await tx
    .update(duoMatches)
    .set({ ratingAppliedAt: at, ratingSnapshot, updatedAt: at })
    .where(eq(duoMatches.id, matchId));
}

/** "Participant duo disbanded, skip entirely" branch — the duo-side analogue of
 * `markPairingRatingSkipped` (§8.3 only names deleted PROFILES explicitly; extending the same
 * "skip entirely, never retry" treatment to a disbanded duo is this job's own judgment call —
 * SPEC-GAP(ws4-t7): §8.3 doesn't say what happens when a duo disbands mid-application). */
export async function markDuoMatchRatingSkipped(tx: Db, matchId: string, at: Date): Promise<void> {
  await tx.update(duoMatches).set({ ratingAppliedAt: at, updatedAt: at }).where(eq(duoMatches.id, matchId));
}

// --- No-game RD inflation (§8.3 "profiles with no games that week: RD-only inflation") -------

/**
 * The already-rated population eligible for this run's no-game inflation: profiles with an
 * existing `ratings` row (lazily created on first game, never for someone who's never played —
 * inflating a profile that's never touched nemesis mode would be meaningless), excluding
 * `status='deleted'` (their `ratings` row is hard-deleted at account deletion, §11.4), whose
 * `ratings.updated_at` is older than `before`.
 *
 * `before` is the caller's idempotency window (job-file constant, not a product-facing magic
 * number — see `RATING_PERIOD_REPROCESS_GUARD_MS` in the job): any profile touched THIS run
 * (a completed pairing applied above, OR a previous inflation pass earlier in a retried run)
 * already has `updated_at = at`, which is never `< before` when `before < at` — so this single
 * timestamp comparison is what makes the whole no-game branch idempotent under retry, without a
 * dedicated "already inflated this week" column (§8.3 doesn't add one, and this task's rules
 * disallow packages/db schema changes).
 */
export async function listRatedProfileIdsForInflation(db: Db, before: Date): Promise<string[]> {
  const rows = await db
    .select({ profileId: ratings.profileId })
    .from(ratings)
    .innerJoin(profiles, eq(profiles.id, ratings.profileId))
    .where(and(ne(profiles.status, 'deleted'), lt(ratings.updatedAt, before)));
  return rows.map((r) => r.profileId);
}

/** Same idempotency-window logic as `listRatedProfileIdsForInflation`, for duo team ratings —
 * only `status='active'` duos (a disbanded duo has no future game to be "idle" toward). */
export async function listActiveDuoIdsForInflation(db: Db, before: Date): Promise<string[]> {
  const rows = await db
    .select({ id: duos.id })
    .from(duos)
    .where(and(eq(duos.status, 'active'), lt(duos.updatedAt, before)));
  return rows.map((r) => r.id);
}

/** Re-fetches one rating row `FOR UPDATE` for the inflation step's per-profile transaction. */
export async function lockRatingForInflation(
  tx: Db,
  profileId: string,
): Promise<{ rating: number; rd: number; vol: number; updatedAt: Date } | null> {
  const rows = await tx.execute(sql`
    SELECT glicko_rating, glicko_rd, glicko_vol, updated_at FROM ratings WHERE profile_id = ${profileId} FOR UPDATE
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    rating: Number(r['glicko_rating']),
    rd: Number(r['glicko_rd']),
    vol: Number(r['glicko_vol']),
    updatedAt: new Date(r['updated_at'] as string),
  };
}

export async function lockDuoForInflation(
  tx: Db,
  duoId: string,
): Promise<{ rating: number; rd: number; vol: number; status: string; updatedAt: Date } | null> {
  const rows = await tx.execute(sql`
    SELECT glicko_rating, glicko_rd, glicko_vol, status, updated_at FROM duos WHERE id = ${duoId} FOR UPDATE
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    rating: Number(r['glicko_rating']),
    rd: Number(r['glicko_rd']),
    vol: Number(r['glicko_vol']),
    status: r['status'] as string,
    updatedAt: new Date(r['updated_at'] as string),
  };
}

// --- Accuracy percentile (§8.3 "nightly, rank of lifetime accuracy among profiles with >=10
// graded picks; display-only" — computed by `fingerprint:nightly`, WS4-T7 task brief) ---------

/**
 * Ensures a `ratings` row exists (lazy-create with defaults, same pattern as
 * `getOrDefaultRating` in `moderation.ts`) then sets `accuracy_percentile` — used for every
 * profile with >= ACCURACY_PERCENTILE_MIN_PICKS resolved picks, regardless of whether they've
 * ever played nemesis (this column lives on `ratings` per §5.4, but the metric itself is a
 * lifetime-accuracy stat, not a Glicko one).
 */
export async function upsertAccuracyPercentile(db: Db, profileId: string, percentile: number, at: Date): Promise<void> {
  await db
    .insert(ratings)
    .values({ profileId, accuracyPercentile: percentile, updatedAt: at })
    .onConflictDoUpdate({ target: ratings.profileId, set: { accuracyPercentile: percentile } });
}

/** Nulls `accuracy_percentile` for existing `ratings` rows that dropped below the eligibility
 * threshold (e.g. a deep-regrade reduced a profile's resolved pick count) — keeps the column
 * honest without touching Glicko fields. No-op (and no row created) if `profileIds` is empty. */
export async function clearAccuracyPercentileFor(db: Db, profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;
  await db
    .update(ratings)
    .set({ accuracyPercentile: null })
    .where(inArray(ratings.profileId, profileIds as string[]));
}
