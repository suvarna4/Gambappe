/**
 * Duo match lifecycle repository helpers (design doc §5.5, §5.7, §8.5, §8.9, WS6-T2).
 *
 * Pure data access only — no scoring/rating math lives here. `packages/db` has no
 * `@receipts/engine` dependency (mirrors WS0's existing architecture: `packages/engine` and
 * `packages/venues` depend on `core`, §4.2 — nothing routes the other way), so the functions
 * that actually CALL `scoreDuoMatch`/`computeDuoSynergy`/`updateGlicko2` live in the
 * apps/web + apps/worker orchestration layers, which both depend on `@receipts/db` AND
 * `@receipts/engine` already. This file only shapes plain data for those pure functions and
 * persists their results — see `apps/worker/src/jobs/duo-match-completion.ts` (normal
 * completion, hooked from `grade:followup`/`reveal:fire`/`duo:window-roll`'s straggler
 * backstop) and `apps/web/lib/duo-match-lifecycle.ts` (mid-window exit on block/suspend/delete,
 * mirroring `apps/web/lib/moderation.ts`'s nemesis-pairing precedent) for the actual math.
 *
 * WS6-T3 addition (§8.10): `ActiveDuoForRoll.matchmakingPriority` +
 * `setDuoMatchmakingPriority` below feed/maintain the ladder's odd-duo sit-out priority flag.
 * Season-boundary standings/movement persistence lives in the sibling `duo-ladder.ts` file
 * (kept separate so this file's WS6-T2 authorship/scope stays legible).
 */
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { duoMatches, duoMatchQuestions, duos, markets, picks, questions } from '../schema/index.js';
// getDuoById/DuoRow: WS4-T7's ratings.ts (same package, intra-package relative import — unlike
// the apps/web precedent noted below, nothing here crosses the packages/db <-> apps/* boundary
// §4.2 protects) landed identical implementations first; re-declaring them here caused a real
// `export *` ambiguity in index.ts once both files existed on main. Imported for this file's
// own internal use only — NOT re-exported here, since index.ts's `export * from
// './repositories/ratings.js'` already makes them (and this file's own unused-here
// incrementDuoMatchesPlayed/updateDuoRating, also deduplicated the same way) available to every
// consumer; re-exporting would recreate the same ambiguity.
import { getDuoById, type DuoRow } from './ratings.js';

export type DuoMatchRow = typeof duoMatches.$inferSelect;
export type NewDuoMatchRow = typeof duoMatches.$inferInsert;
export type DuoBonusCandidateMarketRow = typeof markets.$inferSelect;

// --- lookups ------------------------------------------------------------------------------

/**
 * §5.5: a profile may have at most one active duo. Deliberately duplicated from
 * `apps/web/lib/duo-queue.ts`'s identical query (WS6-T1) rather than importing it —
 * `packages/db` can't depend on `apps/*` (§4.2), so anything packages/db-adjacent code needs
 * (this file; `deleteAccount`'s caller, §11.4) has to have its own copy.
 */
export async function getActiveDuoForProfile(db: Db, profileId: string): Promise<DuoRow | null> {
  const [row] = await db
    .select()
    .from(duos)
    .where(and(or(eq(duos.profileAId, profileId), eq(duos.profileBId, profileId)), eq(duos.status, 'active')))
    .limit(1);
  return row ?? null;
}

/** The duo's currently `scheduled`/`active` match, if any — at most one by construction
 * (window-roll's eligibility pool excludes duos that already have one, §8.5). */
export async function getCurrentMatchForDuo(db: Db, duoId: string): Promise<DuoMatchRow | null> {
  const [row] = await db
    .select()
    .from(duoMatches)
    .where(
      and(
        or(eq(duoMatches.duoAId, duoId), eq(duoMatches.duoBId, duoId)),
        inArray(duoMatches.status, ['scheduled', 'active']),
      ),
    )
    .orderBy(sql`${duoMatches.windowStart} desc`)
    .limit(1);
  return row ?? null;
}

/** Mid-window-exit lookup (§5.7; mirrors `moderation.ts`'s `findActivePairingInvolving` for
 * nemesis): `profileId`'s active duo's currently `scheduled`/`active` match, if any. */
export async function findActiveOrScheduledMatchForProfile(
  db: Db,
  profileId: string,
): Promise<{ match: DuoMatchRow; duo: DuoRow } | null> {
  const duo = await getActiveDuoForProfile(db, profileId);
  if (!duo) return null;
  const match = await getCurrentMatchForDuo(db, duo.id);
  return match ? { match, duo } : null;
}

export async function getDuoMatchById(db: Db, id: string): Promise<DuoMatchRow | null> {
  const [row] = await db.select().from(duoMatches).where(eq(duoMatches.id, id)).limit(1);
  return row ?? null;
}

/** Every `scheduled`/`active` match whose window has fully elapsed as of `todayEtDate` — the
 * `duo:window-roll` straggler backstop's target set (§8.5: "or by the next window-roll as a
 * backstop for stragglers"). */
export async function listOverdueOpenMatches(db: Db, todayEtDate: string): Promise<DuoMatchRow[]> {
  return db
    .select()
    .from(duoMatches)
    .where(and(inArray(duoMatches.status, ['scheduled', 'active']), sql`${duoMatches.windowEnd} < ${todayEtDate}::date`));
}

/** `scheduled`/`active` match ids whose window covers `questionDateEt` — the `reveal:fire`
 * completion-check hook's fan-out for a just-revealed DAILY (§8.5: dailies are derived into a
 * match's question set by date, never stored in `duo_match_questions`). */
export async function listOpenMatchIdsForWindowDate(db: Db, questionDateEt: string): Promise<string[]> {
  const rows = await db
    .select({ id: duoMatches.id })
    .from(duoMatches)
    .where(
      and(
        inArray(duoMatches.status, ['scheduled', 'active']),
        lte(duoMatches.windowStart, questionDateEt),
        gte(duoMatches.windowEnd, questionDateEt),
      ),
    );
  return rows.map((r) => r.id);
}

/** `scheduled`/`active` match ids that reference `questionId` as a bonus question — the
 * `grade:followup` completion-check hook's fan-out for a just-revealed `duo_bonus` question. */
export async function listOpenMatchIdsForBonusQuestion(db: Db, questionId: string): Promise<string[]> {
  const rows = await db
    .select({ id: duoMatches.id })
    .from(duoMatchQuestions)
    .innerJoin(duoMatches, eq(duoMatches.id, duoMatchQuestions.matchId))
    .where(and(eq(duoMatchQuestions.questionId, questionId), inArray(duoMatches.status, ['scheduled', 'active'])));
  return rows.map((r) => r.id);
}

// --- scoring input shaping (§8.9) ------------------------------------------------------------

export interface PickOutcome {
  picked: boolean;
  won: boolean;
  edge: number;
}
const NOT_PICKED: PickOutcome = { picked: false, won: false, edge: 0 };

export interface DuoMatchQuestionScoring {
  questionId: string;
  isVoid: boolean;
  isSettled: boolean;
  duoA: { partner1: PickOutcome; partner2: PickOutcome };
  duoB: { partner1: PickOutcome; partner2: PickOutcome };
}

/** The match's own question set: daily-by-window ∪ bonus (duo_match_questions join). Disjoint
 * by construction — a bonus question's `question_date` is always null (§5.3). */
async function getMatchQuestionRows(
  db: Db,
  match: Pick<DuoMatchRow, 'id' | 'windowStart' | 'windowEnd'>,
): Promise<Array<{ id: string; status: string }>> {
  const dailyRows = await db
    .select({ id: questions.id, status: questions.status })
    .from(questions)
    .where(
      and(
        eq(questions.kind, 'daily'),
        gte(questions.questionDate, match.windowStart),
        lte(questions.questionDate, match.windowEnd),
      ),
    );

  const bonusRows = await db
    .select({ id: questions.id, status: questions.status })
    .from(duoMatchQuestions)
    .innerJoin(questions, eq(questions.id, duoMatchQuestions.questionId))
    .where(eq(duoMatchQuestions.matchId, match.id));

  return [...dailyRows, ...bonusRows];
}

/**
 * Shapes the match's questions + both duos' both members' pick outcomes into
 * `@receipts/engine`'s `scoreDuoMatch` input shape (§8.9). `isSettled` mirrors the nemesis
 * convention (`moderation.ts`'s `getPairingSharedQuestionPicks`): `revealed`/`voided` only —
 * grading alone (still `locked`) doesn't count, since a DAILY's result stays hidden until
 * `reveal:fire` (§6.5 publication rule). Bonus questions reach `revealed` immediately at
 * grading (§8.8.1 "no held reveal") via this task's `grade:followup` extension, so both kinds
 * converge on the same check here.
 */
export async function getDuoMatchScoringInput(db: Db, matchId: string): Promise<DuoMatchQuestionScoring[]> {
  const match = await getDuoMatchById(db, matchId);
  if (!match) return [];
  const [duoA, duoB] = await Promise.all([getDuoById(db, match.duoAId), getDuoById(db, match.duoBId)]);
  if (!duoA || !duoB) return [];

  const questionRows = await getMatchQuestionRows(db, match);
  if (questionRows.length === 0) return [];
  const questionIds = questionRows.map((q) => q.id);
  const memberIds = [duoA.profileAId, duoA.profileBId, duoB.profileAId, duoB.profileBId];

  const pickRows = await db
    .select({ questionId: picks.questionId, profileId: picks.profileId, result: picks.result, edge: picks.edge })
    .from(picks)
    .where(and(inArray(picks.questionId, questionIds), inArray(picks.profileId, memberIds)));

  const picksByQuestion = new Map<string, Map<string, PickOutcome>>();
  for (const p of pickRows) {
    // Pending/void picks are never scoring inputs — a void pick is treated exactly like no pick
    // at all (§8.9: "no pick = 0").
    if (p.result !== 'win' && p.result !== 'loss') continue;
    const forQuestion = picksByQuestion.get(p.questionId) ?? new Map<string, PickOutcome>();
    forQuestion.set(p.profileId, { picked: true, won: p.result === 'win', edge: p.edge ?? 0 });
    picksByQuestion.set(p.questionId, forQuestion);
  }

  return questionRows.map((q) => {
    const byProfile = picksByQuestion.get(q.id) ?? new Map<string, PickOutcome>();
    return {
      questionId: q.id,
      isVoid: q.status === 'voided',
      isSettled: q.status === 'revealed' || q.status === 'voided',
      duoA: {
        partner1: byProfile.get(duoA.profileAId) ?? NOT_PICKED,
        partner2: byProfile.get(duoA.profileBId) ?? NOT_PICKED,
      },
      duoB: {
        partner1: byProfile.get(duoB.profileAId) ?? NOT_PICKED,
        partner2: byProfile.get(duoB.profileBId) ?? NOT_PICKED,
      },
    };
  });
}

/** True once every one of the match's own questions (3 daily + 0–3 bonus) is settled
 * (`revealed`/`voided`) — the "last question grades" completion trigger (§8.5). Empty input
 * (malformed/unlinked match) never reports complete. */
export function isDuoMatchFullyGraded(scoring: DuoMatchQuestionScoring[]): boolean {
  return scoring.length > 0 && scoring.every((q) => q.isSettled);
}

// --- chemistry (§8.9) --------------------------------------------------------------------------

/**
 * Every (partner, question) slot across every match this duo has ever played (any status — a
 * `cancelled` match, by definition of the mid-window-exit rule, always has zero graded shared
 * questions, so including it costs nothing). `joint_hit_rate`/`synergy` are cumulative duo-level
 * stats (§8.9), not per-match, and `duos` stores no running slot/win counters, so this
 * recomputes from full history each time — mirrors §8.12's "computed on demand, no snapshot
 * table at MVP" precedent rather than inventing new schema columns (this task may not modify
 * packages/db schema).
 */
export async function getDuoLifetimeSlots(db: Db, duoId: string): Promise<Array<{ won: boolean }>> {
  const duo = await getDuoById(db, duoId);
  if (!duo) return [];

  const matchRows = await db
    .select({ id: duoMatches.id, windowStart: duoMatches.windowStart, windowEnd: duoMatches.windowEnd })
    .from(duoMatches)
    .where(or(eq(duoMatches.duoAId, duoId), eq(duoMatches.duoBId, duoId)));
  if (matchRows.length === 0) return [];

  const questionIdSet = new Set<string>();
  for (const m of matchRows) {
    const rows = await getMatchQuestionRows(db, m);
    for (const r of rows) questionIdSet.add(r.id);
  }
  if (questionIdSet.size === 0) return [];

  const memberIds = [duo.profileAId, duo.profileBId];
  const pickRows = await db
    .select({ result: picks.result })
    .from(picks)
    .where(
      and(
        inArray(picks.questionId, [...questionIdSet]),
        inArray(picks.profileId, memberIds),
        inArray(picks.result, ['win', 'loss']),
      ),
    );

  return pickRows.map((p) => ({ won: p.result === 'win' }));
}

/**
 * §8.1-style lifetime accuracy computed directly from `picks` (wins / (wins+losses) over
 * graded, non-void picks) — a stand-in for `fingerprints.accuracy`, since `fingerprint:nightly`
 * (WS4-T7) is still a registry stub in this wave (`apps/worker/src/registry.ts`) and can't be
 * relied on to have populated `fingerprints` for either partner. §8.9's chemistry `expected`
 * input just needs *a* lifetime-accuracy number, and this is the same §8.1 formula
 * `fingerprint:nightly` will eventually also compute. Returns 0 if the profile has no graded
 * picks (shouldn't bind in practice — `DUO_MIN_PICKS` gates duo membership on ≥10 already).
 */
export async function computeLifetimeAccuracy(db: Db, profileId: string): Promise<number> {
  const [row] = await db
    .select({
      wins: sql<number>`count(*) filter (where ${picks.result} = 'win')::int`,
      total: sql<number>`count(*) filter (where ${picks.result} in ('win', 'loss'))::int`,
    })
    .from(picks)
    .where(eq(picks.profileId, profileId));
  const total = row?.total ?? 0;
  if (total === 0) return 0;
  return (row?.wins ?? 0) / total;
}

/**
 * Persists chemistry (§8.9). `jointHitRate` is written whenever there's at least one lifetime
 * slot (`computeDuoSynergy` — `@receipts/engine` — always returns a number for it, never null);
 * `synergy` is written exactly as the pure function returns it (null below
 * `SYNERGY_MIN_PICKS`). Note: `packages/core`'s `duoPublicSchema` doc-comments the
 * `SYNERGY_MIN_PICKS` gate on `joint_hit_rate`, while the `duos` Drizzle schema comments it on
 * `synergy` — a minor pre-existing doc inconsistency between the two; this follows the PURE
 * FUNCTION's actual return shape (only `synergy` is gated) per this task's instructions. Caller
 * skips the update entirely when there are zero lifetime slots, leaving both columns at their
 * `null` default (no data yet, vs. a misleading `0`).
 */
export async function updateDuoChemistry(
  db: Db,
  duoId: string,
  jointHitRate: number,
  synergy: number | null,
  at: Date,
): Promise<void> {
  await db.update(duos).set({ jointHitRate, synergy, updatedAt: at }).where(eq(duos.id, duoId));
}

// --- match conclusion (§5.7, §8.9) -------------------------------------------------------------

export interface DuoMatchConclusionInput {
  status: 'completed' | 'cancelled';
  scoreA?: number;
  scoreB?: number;
  winnerDuoId?: string | null;
  ratingAppliedAt?: Date;
  ratingSnapshot?: Record<string, unknown> | null;
}

export async function updateDuoMatchConclusion(
  db: Db,
  matchId: string,
  input: DuoMatchConclusionInput,
  at: Date,
): Promise<void> {
  await db
    .update(duoMatches)
    .set({
      status: input.status,
      ...(input.scoreA !== undefined ? { scoreA: input.scoreA } : {}),
      ...(input.scoreB !== undefined ? { scoreB: input.scoreB } : {}),
      ...(input.winnerDuoId !== undefined ? { winnerDuoId: input.winnerDuoId } : {}),
      ...(input.ratingAppliedAt !== undefined ? { ratingAppliedAt: input.ratingAppliedAt } : {}),
      ...(input.ratingSnapshot !== undefined ? { ratingSnapshot: input.ratingSnapshot } : {}),
      updatedAt: at,
    })
    .where(eq(duoMatches.id, matchId));
}

// --- window-roll (§8.5) -------------------------------------------------------------------------

export interface ActiveDuoForRoll {
  duoId: string;
  rating: number;
  tier: number;
  /** §8.10 (WS6-T3): `duos.matchmaking_priority` — fed into `matchDuoVsDuo`'s odd-one-out
   * selection so a duo that already sat out a window gets first claim on a spot this run. */
  matchmakingPriority: boolean;
}

/** Active duos with no CURRENTLY `scheduled`/`active` match — the window-roll pairing pool
 * (§8.5). A duo already mid-match never gets double-booked into a second one. */
export async function listEligibleDuosForWindowRoll(db: Db): Promise<ActiveDuoForRoll[]> {
  const rows = await db.execute(sql`
    SELECT d.id, d.glicko_rating, d.tier, d.matchmaking_priority
    FROM duos d
    WHERE d.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM duo_matches dm
        WHERE (dm.duo_a_id = d.id OR dm.duo_b_id = d.id) AND dm.status IN ('scheduled', 'active')
      )
  `);
  return rows.rows.map((r) => ({
    duoId: r['id'] as string,
    rating: Number(r['glicko_rating']),
    tier: Number(r['tier']),
    matchmakingPriority: r['matchmaking_priority'] === true,
  }));
}

export interface NewDuoMatchInput {
  id: string;
  duoAId: string;
  duoBId: string;
  windowStart: string;
  windowEnd: string;
}

/** Window-roll fires exactly at window-open time (Tue/Fri 09:00 ET = the window's first daily's
 * `open_at`, DD-1), so the match is created directly `active` rather than transiting through a
 * separately-observable `scheduled` instant (§5.7 lists `scheduled → active` for the analogous
 * nemesis pairing at "Monday open" — same reasoning; no `nemesis:assign` precedent exists yet
 * to confirm the exact mechanics since that job is still a stub). */
export async function createDuoMatch(db: Db, input: NewDuoMatchInput): Promise<DuoMatchRow> {
  const [inserted] = await db
    .insert(duoMatches)
    .values({
      id: input.id,
      duoAId: input.duoAId,
      duoBId: input.duoBId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      status: 'active',
    })
    .returning();
  if (!inserted) throw new Error('createDuoMatch: no row returned');
  return inserted;
}

export async function insertDuoMatchQuestion(db: Db, matchId: string, questionId: string): Promise<void> {
  await db.insert(duoMatchQuestions).values({ matchId, questionId }).onConflictDoNothing();
}

/** `duo_bonus` candidate markets (§8.8.1 pool, reusing the `nemesis_eligible` curation tag —
 * `questions.ts`'s comment: "one flag feeds both §8.8.1's nemesis bonus pool and duo_bonus
 * question curation"), resolving within the window, still tradeable. Ordered soonest-closing
 * first for determinism. */
export async function listDuoBonusCandidateMarkets(
  db: Db,
  windowStartInstant: Date,
  windowEndInstant: Date,
  limit: number,
): Promise<DuoBonusCandidateMarketRow[]> {
  return db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.nemesisEligible, true),
        eq(markets.status, 'open'),
        gte(markets.closeTime, windowStartInstant),
        lte(markets.closeTime, windowEndInstant),
      ),
    )
    .orderBy(markets.closeTime)
    .limit(limit);
}

/** §8.8.1 dedup: reuse an already-authored, still-usable `duo_bonus` question for this market
 * rather than creating a duplicate. `scheduled` is included (not just `open`) so multiple
 * matches created within the SAME `duo:window-roll` run correctly see and share a sibling
 * question authored moments earlier in the same run, before its `question:open` job has fired. */
export async function findReusableDuoBonusQuestionForMarket(
  db: Db,
  marketId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.marketId, marketId),
        eq(questions.kind, 'duo_bonus'),
        inArray(questions.status, ['scheduled', 'open']),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** §8.10 (WS6-T3): bulk-set/clear `duos.matchmaking_priority` (server-only column) — mirrors
 * `nemesis.ts`'s `setMatchmakingPriority` for profiles exactly, one column over. Called every
 * `duo:window-roll` run: clear for every duo considered this run (matched or not), then set
 * true only for this run's actual `oddOneOut`. */
export async function setDuoMatchmakingPriority(
  db: Db,
  duoIds: readonly string[],
  value: boolean,
  at: Date,
): Promise<void> {
  if (duoIds.length === 0) return;
  await db.update(duos).set({ matchmakingPriority: value, updatedAt: at }).where(inArray(duos.id, duoIds));
}
