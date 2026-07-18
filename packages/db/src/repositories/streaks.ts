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
import { eq, sql } from 'drizzle-orm';
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
