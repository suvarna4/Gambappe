/**
 * Ghost→profile merge (design doc §6.4, claim case C). One DB transaction implementing steps
 * 1–5; step 6 (`fingerprint:recompute(P)` enqueue) is a SPEC-GAP — no consuming job exists in
 * this wave (WS4/later). Called by WS2-T3's `/claim` route handler.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { picks, placementAnswers, profiles, questions, reactions, streakFreezeUses } from '../schema/index.js';
import { replayStreak, type ReplayDailyQuestion, type ReplayFreezeUse, type ReplayPick } from '../streak-replay.js';

export interface MergeResult {
  targetProfileId: string;
  mergedGhostId: string;
  picksReassigned: number;
  picksDeduped: number;
}

/**
 * Merge ghost `ghostId` into claimed profile `targetId` (§6.4). `at` is the merge instant
 * (from `@receipts/core` `now()` at the call site — this package stays clock-agnostic per
 * §17.2, taking time as a parameter like `packages/engine`).
 */
export async function mergeGhostIntoProfile(
  db: Db,
  ghostId: string,
  targetId: string,
  at: Date,
): Promise<MergeResult> {
  return db.transaction(async (tx) => {
    // --- Step 1: picks — reassign or dedupe (P wins; decrement live counters if still open) ---
    const ghostPicks = await tx.select().from(picks).where(eq(picks.profileId, ghostId));
    let picksReassigned = 0;
    let picksDeduped = 0;

    for (const gp of ghostPicks) {
      const [existing] = await tx
        .select({ id: picks.id })
        .from(picks)
        .where(and(eq(picks.questionId, gp.questionId), eq(picks.profileId, targetId)))
        .limit(1);

      if (!existing) {
        await tx.update(picks).set({ profileId: targetId }).where(eq(picks.id, gp.id));
        picksReassigned += 1;
        continue;
      }

      // P already picked this question: G's pick is dropped, P's stands.
      await tx.delete(picks).where(eq(picks.id, gp.id));
      picksDeduped += 1;
      const [q] = await tx
        .select({ status: questions.status })
        .from(questions)
        .where(eq(questions.id, gp.questionId))
        .limit(1);
      if (q?.status === 'open') {
        const column = gp.side === 'yes' ? questions.yesCount : questions.noCount;
        await tx
          .update(questions)
          .set({ [gp.side === 'yes' ? 'yesCount' : 'noCount']: sql`${column} - 1` })
          .where(eq(questions.id, gp.questionId));
      }
    }

    // --- Step 2: streak_freeze_uses — reparent, dedupe by (profile_id, covered_date), P wins --
    const ghostFreezeUses = await tx
      .select()
      .from(streakFreezeUses)
      .where(eq(streakFreezeUses.profileId, ghostId));
    for (const fu of ghostFreezeUses) {
      await tx
        .insert(streakFreezeUses)
        .values({ profileId: targetId, coveredDate: fu.coveredDate, usedAt: fu.usedAt })
        .onConflictDoNothing({
          target: [streakFreezeUses.profileId, streakFreezeUses.coveredDate],
        });
    }
    await tx.delete(streakFreezeUses).where(eq(streakFreezeUses.profileId, ghostId));

    // --- Step 2b: reactions — reparent, dedupe by (context_kind, context_id, profile_id, emoji)
    const ghostReactions = await tx.select().from(reactions).where(eq(reactions.profileId, ghostId));
    for (const r of ghostReactions) {
      const [existing] = await tx
        .select({ id: reactions.id })
        .from(reactions)
        .where(
          and(
            eq(reactions.contextKind, r.contextKind),
            eq(reactions.contextId, r.contextId),
            eq(reactions.profileId, targetId),
            eq(reactions.emoji, r.emoji),
          ),
        )
        .limit(1);
      if (existing) {
        await tx.delete(reactions).where(eq(reactions.id, r.id));
      } else {
        await tx.update(reactions).set({ profileId: targetId }).where(eq(reactions.id, r.id));
      }
    }

    // --- Step 2c: placement_answers — reparent, dedupe by (profile_id, placement_item_id) -----
    const ghostAnswers = await tx
      .select()
      .from(placementAnswers)
      .where(eq(placementAnswers.profileId, ghostId));
    for (const a of ghostAnswers) {
      const [existing] = await tx
        .select({ profileId: placementAnswers.profileId })
        .from(placementAnswers)
        .where(
          and(
            eq(placementAnswers.profileId, targetId),
            eq(placementAnswers.placementItemId, a.placementItemId),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .delete(placementAnswers)
          .where(
            and(
              eq(placementAnswers.profileId, ghostId),
              eq(placementAnswers.placementItemId, a.placementItemId),
            ),
          );
      } else {
        await tx
          .update(placementAnswers)
          .set({ profileId: targetId })
          .where(
            and(
              eq(placementAnswers.profileId, ghostId),
              eq(placementAnswers.placementItemId, a.placementItemId),
            ),
          );
      }
    }

    // Step 3 (§6.4): ghosts can't post — no `posts` re-parenting needed.

    // --- Step 4: recompute P's streak fields from the merged pick history (§6.6 replay) -------
    const dailyQuestionRows = await tx
      .select({ id: questions.id, questionDate: questions.questionDate, status: questions.status })
      .from(questions)
      .where(and(eq(questions.kind, 'daily'), sql`${questions.status} IN ('revealed', 'voided')`));
    const dailyQuestions: ReplayDailyQuestion[] = dailyQuestionRows
      .filter((q): q is { id: string; questionDate: string; status: 'revealed' | 'voided' } =>
        q.questionDate !== null,
      )
      .map((q) => ({ id: q.id, questionDate: q.questionDate, status: q.status as 'revealed' | 'voided' }));

    const targetPickRows = await tx
      .select({ questionId: picks.questionId, result: picks.result })
      .from(picks)
      .where(eq(picks.profileId, targetId));
    const targetPicks: ReplayPick[] = targetPickRows;

    const targetFreezeRows = await tx
      .select({ coveredDate: streakFreezeUses.coveredDate })
      .from(streakFreezeUses)
      .where(eq(streakFreezeUses.profileId, targetId));
    const targetFreezeUses: ReplayFreezeUse[] = targetFreezeRows;

    const replay = replayStreak(dailyQuestions, targetPicks, targetFreezeUses);
    await tx
      .update(profiles)
      .set({
        currentStreak: replay.currentStreak,
        bestStreak: replay.bestStreak,
        lastCountedDate: replay.lastCountedDate,
        currentWinStreak: replay.currentWinStreak,
        bestWinStreak: replay.bestWinStreak,
        updatedAt: at,
      })
      .where(eq(profiles.id, targetId));

    // --- Step 5: mark G merged/deleted -----------------------------------------------------
    await tx
      .update(profiles)
      .set({
        status: 'deleted',
        mergedIntoProfileId: targetId,
        ghostSecretHash: null,
        updatedAt: at,
      })
      .where(eq(profiles.id, ghostId));

    // SPEC-GAP(WS2-T3): fingerprint:recompute(P) enqueue deferred — no consuming job exists yet
    // (the engine/fingerprint pipeline is WS4/later scope).

    return { targetProfileId: targetId, mergedGhostId: ghostId, picksReassigned, picksDeduped };
  });
}
