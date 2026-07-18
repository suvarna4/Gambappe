/**
 * Duo queue business logic (design doc §8.5, §9.2, WS6-T1) — the DB-facing half shared by
 * `POST/DELETE /api/v1/duo/queue` and `GET /api/v1/duo/current`. The actual partner-matching
 * algorithm (band widening, complementarity) is the WS4-T5 pure function `matchDuoPartner` in
 * `@receipts/engine`, called from the worker job (`apps/worker/src/jobs/duo-matchmaker.ts`) —
 * nothing here re-implements it.
 */
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ApiError, DUO_MIN_PICKS, now } from '@receipts/core';
import {
  duoMatches,
  duoQueueEntries,
  duos,
  isUniqueViolation,
  picks,
  type Db,
  type ProfileRow,
} from '@receipts/db';

export type DuoRow = typeof duos.$inferSelect;
export type DuoMatchRow = typeof duoMatches.$inferSelect;
export type DuoQueueEntryRow = typeof duoQueueEntries.$inferSelect;

/** §8.1/§8.4/§8.5 "graded picks": result has moved past `pending` (win/loss/void). */
export async function countGradedPicks(db: Db, profileId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(picks)
    .where(and(eq(picks.profileId, profileId), ne(picks.result, 'pending')));
  return row?.n ?? 0;
}

/** §5.5: a profile may have at most one `active` duo. */
export async function getActiveDuoForProfile(db: Db, profileId: string): Promise<DuoRow | null> {
  const [row] = await db
    .select()
    .from(duos)
    .where(and(or(eq(duos.profileAId, profileId), eq(duos.profileBId, profileId)), eq(duos.status, 'active')))
    .limit(1);
  return row ?? null;
}

/** §5.5: a profile may have at most one `waiting` queue entry (partial-unique constraint). */
export async function getWaitingEntry(db: Db, profileId: string): Promise<DuoQueueEntryRow | null> {
  const [row] = await db
    .select()
    .from(duoQueueEntries)
    .where(and(eq(duoQueueEntries.profileId, profileId), eq(duoQueueEntries.status, 'waiting')))
    .limit(1);
  return row ?? null;
}

export type DuoEligibilityReason =
  | 'not_active'
  | 'insufficient_picks'
  | 'already_in_duo'
  | 'already_queued';

export interface DuoEligibilityResult {
  eligible: boolean;
  reason?: DuoEligibilityReason;
  gradedPicks: number;
}

/**
 * §8.5 eligibility gates for the duo queue: claimed (enforced by the route's auth check before
 * this is even called — `POST /duo/queue` auth is `claimed`, §9.2), active, ≥ DUO_MIN_PICKS
 * graded picks, no active duo already. The "single waiting entry per profile" rule isn't in the
 * §8.5 eligibility sentence itself, but the schema's partial-unique constraint (§5.5) and this
 * task's AC ("single waiting entry per profile enforced") both require it — folded in here as
 * the same ELIGIBILITY_NOT_MET family since it's the same "you can't join right now" shape.
 */
export async function checkDuoEligibility(db: Db, profile: ProfileRow): Promise<DuoEligibilityResult> {
  if (profile.status !== 'active') {
    return { eligible: false, reason: 'not_active', gradedPicks: 0 };
  }

  const gradedPicks = await countGradedPicks(db, profile.id);
  if (gradedPicks < DUO_MIN_PICKS) {
    return { eligible: false, reason: 'insufficient_picks', gradedPicks };
  }

  const activeDuo = await getActiveDuoForProfile(db, profile.id);
  if (activeDuo) {
    return { eligible: false, reason: 'already_in_duo', gradedPicks };
  }

  const alreadyQueued = await getWaitingEntry(db, profile.id);
  if (alreadyQueued) {
    return { eligible: false, reason: 'already_queued', gradedPicks };
  }

  return { eligible: true, gradedPicks };
}

const ELIGIBILITY_MESSAGES: Record<DuoEligibilityReason, string> = {
  not_active: 'your profile must be active to join the duo queue',
  insufficient_picks: `at least ${DUO_MIN_PICKS} graded picks are required to join the duo queue`,
  already_in_duo: 'you already have an active duo',
  already_queued: 'you are already in the duo queue',
};

// SPEC-GAP(ws6-t1): Appendix C has no dedicated error code for "already in the duo queue" (or
// for the other duo eligibility rejections) — reusing ELIGIBILITY_NOT_MET (422, the existing
// code for "nemesis/duo thresholds not reached") for all four rejection reasons, distinguished
// via `details.reason`. A dedicated code per reason would need a packages/core contract-change
// PR; flagging here rather than making that call unilaterally.
export function eligibilityError(reason: DuoEligibilityReason, gradedPicks: number): ApiError {
  return new ApiError('ELIGIBILITY_NOT_MET', ELIGIBILITY_MESSAGES[reason], {
    reason,
    graded_picks: gradedPicks,
    required: DUO_MIN_PICKS,
  });
}

/**
 * `POST /duo/queue` (§9.2): re-validates eligibility then inserts a `waiting` row. The schema's
 * partial-unique `(profile_id) where status='waiting'` index (§5.5) is the actual race-closer;
 * the eligibility pre-check just gives a clean, specific error in the common (non-race) case.
 */
export async function joinDuoQueue(db: Db, profile: ProfileRow): Promise<DuoQueueEntryRow> {
  const check = await checkDuoEligibility(db, profile);
  if (!check.eligible) throw eligibilityError(check.reason!, check.gradedPicks);

  try {
    const [row] = await db
      .insert(duoQueueEntries)
      .values({ id: uuidv7(), profileId: profile.id, status: 'waiting', enqueuedAt: now() })
      .returning();
    if (!row) throw new Error('joinDuoQueue: no row returned');
    return row;
  } catch (err) {
    // Defense-in-depth against a TOCTOU race on the partial-unique constraint (packages/db's
    // pg-errors.ts documents exactly this pattern: pre-check for a clean error, still catch the
    // raw DB error for the race the pre-check can't fully close — e.g. two concurrent requests
    // from the same profile).
    if (isUniqueViolation(err)) {
      throw eligibilityError('already_queued', check.gradedPicks);
    }
    throw err;
  }
}

/**
 * `DELETE /duo/queue` (§9.2): leaves the queue. The waiting row transitions to `cancelled`
 * rather than being hard-deleted — unlike `picks` (§5.3 explicitly calls for hard DELETE on
 * undo), §5.5 gives `duo_queue_entries.status` a `cancelled` value specifically for this, and
 * nothing in §8.5/§9.2 calls for destroying the row. Returns false when the caller has no
 * waiting entry (route maps that to 404).
 */
export async function leaveDuoQueue(db: Db, profileId: string): Promise<boolean> {
  const result = await db
    .update(duoQueueEntries)
    .set({ status: 'cancelled' })
    .where(and(eq(duoQueueEntries.profileId, profileId), eq(duoQueueEntries.status, 'waiting')))
    .returning({ id: duoQueueEntries.id });
  return result.length > 0;
}

export interface CurrentDuoAndMatch {
  duo: DuoRow | null;
  match: DuoMatchRow | null;
}

/** `GET /duo/current` (§9.2): the caller's active duo (if any) + its current match. */
export async function getCurrentDuoAndMatch(db: Db, profileId: string): Promise<CurrentDuoAndMatch> {
  const duo = await getActiveDuoForProfile(db, profileId);
  if (!duo) return { duo: null, match: null };

  // "Current match" = the duo's most recent not-yet-finished window (scheduled or active).
  // Completed/cancelled matches are history — WS6-T4's `GET /duos/:id` owns match_history
  // (§9.2), so this deliberately only surfaces the live one.
  const [match] = await db
    .select()
    .from(duoMatches)
    .where(
      and(
        or(eq(duoMatches.duoAId, duo.id), eq(duoMatches.duoBId, duo.id)),
        inArray(duoMatches.status, ['scheduled', 'active']),
      ),
    )
    .orderBy(desc(duoMatches.windowStart))
    .limit(1);

  return { duo, match: match ?? null };
}
