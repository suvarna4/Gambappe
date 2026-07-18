/**
 * Streak processing (§6.6, WS3-T3): the DB-touching orchestration around the pure
 * `decideGapFreezeConsumption`/`replayStreak` helpers (`../streak-replay.js`). Two call sites:
 *
 *  - `applyStreakForParticipant` — `reveal:fire` (WS3-T4), once per profile with a graded pick
 *    on the daily that just revealed.
 *  - `applyStreakForNonParticipant` — `streak:sweep`, once per profile that missed a daily
 *    whose reveal has already fired (or voided) without them.
 *
 * Both persist any newly-decided `streak_freeze_uses` + `freeze_bank` decrement, then call
 * `replayStreak` (not hand-rolled math) over the profile's full pick history to get the
 * resulting canonical streak fields — so the ONLY logic unique to this file is "what freeze
 * consumption is newly decided," never "what the resulting streak length is" (§6.6, reusing the
 * WS2-T3 replay procedure per the WS3 task brief).
 */
import { eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { profiles, streakFreezeUses } from '../schema/index.js';
import {
  decideGapFreezeConsumption,
  replayStreak,
  type ReplayDailyQuestion,
  type ReplayFreezeUse,
  type ReplayPick,
  type StreakReplayResult,
} from '../streak-replay.js';
import { getPicksForProfile } from './picks.js';
import { listRevealedOrVoidedDailyThrough } from './questions.js';

interface ProfileStreakFields {
  freezeBank: number;
  lastCountedDate: string | null;
  currentStreak: number;
}

async function getProfileStreakFields(tx: Db, profileId: string): Promise<ProfileStreakFields | null> {
  const [row] = await tx
    .select({
      freezeBank: profiles.freezeBank,
      lastCountedDate: profiles.lastCountedDate,
      currentStreak: profiles.currentStreak,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return row ?? null;
}

async function getFreezeUses(tx: Db, profileId: string): Promise<ReplayFreezeUse[]> {
  const rows = await tx
    .select({ coveredDate: streakFreezeUses.coveredDate })
    .from(streakFreezeUses)
    .where(eq(streakFreezeUses.profileId, profileId));
  return rows;
}

/** Public wrapper — used by the reveal payload (apps/web) to reconstruct "was a freeze used for
 * THIS reveal's gap" without a dedicated per-reveal ledger (§6.7 viewer streak block). */
export async function getFreezeUsesForProfile(db: Db, profileId: string): Promise<ReplayFreezeUse[]> {
  return getFreezeUses(db, profileId);
}

/** Persists newly-decided freeze uses + the decremented bank (idempotent: `ON CONFLICT DO
 * NOTHING` on the `(profile_id, covered_date)` PK — a re-run that already recorded a date is a
 * safe no-op for that row). */
async function persistNewFreezeUses(
  tx: Db,
  profileId: string,
  newDates: string[],
  freezeBankAfter: number,
  at: Date,
): Promise<void> {
  if (newDates.length > 0) {
    await tx
      .insert(streakFreezeUses)
      .values(newDates.map((coveredDate) => ({ profileId, coveredDate, usedAt: at })))
      .onConflictDoNothing({ target: [streakFreezeUses.profileId, streakFreezeUses.coveredDate] });
  }
  await tx.update(profiles).set({ freezeBank: freezeBankAfter, updatedAt: at }).where(eq(profiles.id, profileId));
}

export interface StreakApplyResult extends StreakReplayResult {
  freezeUsedForGap: boolean;
  previousStreak: number;
  /** `freeze_bank` after this call's consumption (WS9-T3: `streak_freeze_used` beat data,
   * §13.3 "{n} left" — additive field, not itself new streak logic). */
  freezeBankAfter: number;
}

/**
 * §6.6 "Reveal of day D (participants)": profile has a graded pick on daily `D`. Applies the
 * gap rule up to (not including) `D`, persists any new freeze use, then always increments for
 * `D` itself (win streak too — win increments, loss resets) via a full replay. `dailyHistory`
 * must include `D` and everything before it (revealed/voided).
 */
export async function applyStreakForParticipant(
  tx: Db,
  profileId: string,
  dailyHistory: ReplayDailyQuestion[],
  throughDate: string,
  at: Date,
): Promise<StreakApplyResult> {
  const before = await getProfileStreakFields(tx, profileId);
  if (!before) throw new Error(`applyStreakForParticipant: no profile ${profileId}`);
  const existingFreezeUses = await getFreezeUses(tx, profileId);
  const picks: ReplayPick[] = await getPicksForProfile(tx, profileId);

  const decision = decideGapFreezeConsumption({
    dailyQuestions: dailyHistory,
    picks,
    existingFreezeUses,
    lastCountedDate: before.lastCountedDate,
    throughDate,
    includeThroughDate: false, // D itself always increments below, not part of the gap walk
    freezeBankBefore: before.freezeBank,
  });

  await persistNewFreezeUses(tx, profileId, decision.newFreezeUses, decision.freezeBankAfter, at);

  const allFreezeUses = [...existingFreezeUses, ...decision.newFreezeUses.map((coveredDate) => ({ coveredDate }))];
  const result = replayStreak(dailyHistory, picks, allFreezeUses);

  await tx
    .update(profiles)
    .set({
      currentStreak: result.currentStreak,
      bestStreak: result.bestStreak,
      lastCountedDate: result.lastCountedDate,
      currentWinStreak: result.currentWinStreak,
      bestWinStreak: result.bestWinStreak,
      updatedAt: at,
    })
    .where(eq(profiles.id, profileId));

  return {
    ...result,
    freezeUsedForGap: decision.newFreezeUses.length > 0,
    previousStreak: before.currentStreak,
    freezeBankAfter: decision.freezeBankAfter,
  };
}

/**
 * §6.6 "streak:sweep — non-participants": profile missed daily `D` (already revealed/voided,
 * no pick). Applies the gap rule THROUGH (inclusive) `D` — non-participants never increment,
 * only advance (freeze-covered) or break.
 */
export async function applyStreakForNonParticipant(
  tx: Db,
  profileId: string,
  dailyHistory: ReplayDailyQuestion[],
  throughDate: string,
  at: Date,
): Promise<StreakApplyResult> {
  const before = await getProfileStreakFields(tx, profileId);
  if (!before) throw new Error(`applyStreakForNonParticipant: no profile ${profileId}`);
  const existingFreezeUses = await getFreezeUses(tx, profileId);
  const picks: ReplayPick[] = await getPicksForProfile(tx, profileId);

  const decision = decideGapFreezeConsumption({
    dailyQuestions: dailyHistory,
    picks,
    existingFreezeUses,
    lastCountedDate: before.lastCountedDate,
    throughDate,
    includeThroughDate: true,
    freezeBankBefore: before.freezeBank,
  });

  await persistNewFreezeUses(tx, profileId, decision.newFreezeUses, decision.freezeBankAfter, at);

  const allFreezeUses = [...existingFreezeUses, ...decision.newFreezeUses.map((coveredDate) => ({ coveredDate }))];
  const result = replayStreak(dailyHistory, picks, allFreezeUses);

  await tx
    .update(profiles)
    .set({
      currentStreak: result.currentStreak,
      bestStreak: result.bestStreak,
      lastCountedDate: result.lastCountedDate,
      currentWinStreak: result.currentWinStreak,
      bestWinStreak: result.bestWinStreak,
      updatedAt: at,
    })
    .where(eq(profiles.id, profileId));

  return {
    ...result,
    freezeUsedForGap: decision.newFreezeUses.length > 0,
    previousStreak: before.currentStreak,
    freezeBankAfter: decision.freezeBankAfter,
  };
}

export interface StreakSweepCandidate {
  profileId: string;
}

/** Profiles eligible for `streak:sweep` processing through `throughDate` (§6.6): a positive
 * streak, not already advanced past `throughDate`, and no answered pick on that day's daily. */
export async function listStreakSweepCandidates(
  db: Db,
  dailyQuestionId: string,
  throughDate: string,
): Promise<StreakSweepCandidate[]> {
  const rows = await db.execute(sql`
    SELECT p.id AS profile_id
    FROM profiles p
    WHERE p.current_streak > 0
      AND p.status != 'deleted'
      AND (p.last_counted_date IS NULL OR p.last_counted_date < ${throughDate})
      AND NOT EXISTS (
        SELECT 1 FROM picks pk
        WHERE pk.profile_id = p.id AND pk.question_id = ${dailyQuestionId} AND pk.result != 'void'
      )
  `);
  return rows.rows.map((r) => ({ profileId: r['profile_id'] as string }));
}

/**
 * Profiles earning a freeze this week (§6.6 `streak:freeze-grant`, Mondays 00:05 ET):
 * answered >= FREEZE_EARN_MIN_DAYS of the prior 7 dailies (`dailyQuestionIds`), are below
 * STREAK_FREEZE_CAP, and haven't already been granted for `windowStart` this run — the
 * `last_freeze_grant_week` self-exclusion is what makes a crash-then-redelivery re-run a no-op
 * for profiles the crashed run already granted (mirrors `streak:sweep`'s `last_counted_date`
 * self-exclusion; without it, a still-below-cap profile would otherwise re-qualify and be
 * granted twice for the same week, §19.4 rule 4).
 */
export async function listFreezeGrantCandidates(
  db: Db,
  dailyQuestionIds: string[],
  minDays: number,
  cap: number,
  windowStart: string,
): Promise<string[]> {
  if (dailyQuestionIds.length === 0) return [];
  const idArray = `{${dailyQuestionIds.join(',')}}`;
  const rows = await db.execute(sql`
    SELECT p.id AS profile_id
    FROM profiles p
    WHERE p.freeze_bank < ${cap}
      AND p.status != 'deleted'
      AND (p.last_freeze_grant_week IS NULL OR p.last_freeze_grant_week != ${windowStart}::date)
      AND (
        SELECT count(DISTINCT pk.question_id)
        FROM picks pk
        WHERE pk.profile_id = p.id
          AND pk.question_id = ANY(${idArray}::uuid[])
          AND pk.result != 'void'
      ) >= ${minDays}
  `);
  return rows.rows.map((r) => r['profile_id'] as string);
}

/** Grants one freeze (capped) to `profileId` and stamps `last_freeze_grant_week` — used by
 * `streak:freeze-grant`. The stamp is what lets `listFreezeGrantCandidates` self-exclude
 * already-granted profiles on a redelivered re-run of the same week. */
export async function grantFreezeTx(
  tx: Db,
  profileId: string,
  cap: number,
  windowStart: string,
  at: Date,
): Promise<void> {
  await tx.execute(sql`
    UPDATE profiles
    SET freeze_bank = LEAST(freeze_bank + 1, ${cap}),
        last_freeze_grant_week = ${windowStart}::date,
        updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${profileId}
  `);
}

/**
 * Full streak rebuild for one profile (§6.6 "Replay procedure (used by merge, regrade,
 * post-reveal void)", WS10-T3): re-derives `current_streak`/`best_streak`/`last_counted_date`/
 * win streaks from scratch against the profile's CURRENT pick history — unlike
 * `applyStreakForParticipant`/`applyStreakForNonParticipant`, this never decides NEW freeze
 * consumption (existing `streak_freeze_uses` rows are honored exactly as recorded, per §6.6),
 * so it's safe to call after a pick's result changed underneath a profile (a regraded outcome
 * flip, or a pick voided by an admin's post-reveal void) without double-consuming freezes.
 * `freeze_bank` itself is left untouched, matching the merge (§6.4 step 4) precedent this reuses.
 */
export async function replayStreakForProfileTx(tx: Db, profileId: string, at: Date): Promise<StreakReplayResult> {
  const throughDate = at.toISOString().slice(0, 10);
  const dailyQuestions = await listRevealedOrVoidedDailyThrough(tx, throughDate);
  const picks: ReplayPick[] = await getPicksForProfile(tx, profileId);
  const freezeUses = await getFreezeUses(tx, profileId);

  const result = replayStreak(dailyQuestions, picks, freezeUses);

  await tx
    .update(profiles)
    .set({
      currentStreak: result.currentStreak,
      bestStreak: result.bestStreak,
      lastCountedDate: result.lastCountedDate,
      currentWinStreak: result.currentWinStreak,
      bestWinStreak: result.bestWinStreak,
      updatedAt: at,
    })
    .where(eq(profiles.id, profileId));

  return result;
}

/**
 * Every profile with ANY streak history (`last_counted_date IS NOT NULL`) — used by WS10-T3's
 * post-reveal void to find non-participants who need a streak replay too, not just the voided
 * question's own pick-holders. Why this is necessary: `streak:sweep` runs daily at 03:30 ET,
 * inside the 48h post-reveal void window, and BREAKS a non-participant's streak against a day
 * that (per §6.6: "void days never count for/against streaks") must never break anything once
 * that day is voided. There is no ledger of "which profiles the sweep touched for date D" —
 * sweep only writes the RESULTING streak fields, and a broken profile's `current_streak` is
 * already 0 by the time an admin void runs, so a `current_streak > 0` filter (which would find
 * the CANDIDATES *before* a sweep breaks them) can't find the ones already broken *after*.
 * Replaying every profile with any streak history is the only reliable catch-all: `replayStreak`
 * (§6.6, `../streak-replay.js`) already treats a `voided` day correctly (advances through it
 * without breaking or incrementing) once the daily's status flip is visible to it, so re-running
 * it for a profile untouched by this date is simply a no-op, not a correctness risk — only a
 * cost. Accepted here because post-reveal void is a rare, deliberate admin action, not a hot
 * path; this does not scale to "replay everyone" on every ordinary grading/reveal.
 */
export async function listProfileIdsWithStreakHistory(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(isNotNull(profiles.lastCountedDate));
  return rows.map((r) => r.id);
}
