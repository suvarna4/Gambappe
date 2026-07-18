import { and, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { users, questions, nemesisPairings, nemesisMembers, nemesisMatchQuestions, picks } from "./schema";
import { resolvedCompetitivePicks } from "./queries";
import { matchNemeses, type NemesisCandidate } from "@/engine/matchmaking/nemesis-lite";
import { CONSTANTS } from "@/shared/constants";
import { etDateStr } from "@/shared/time";

/** §16.5/§7.11.1 eligibility: claimed, active, >= NEMESIS_MIN_PICKS resolved competitive picks, no active pairing. */
export async function eligibleNemesisCandidates(): Promise<NemesisCandidate[]> {
  const claimed = await db.select().from(users).where(and(eq(users.kind, "claimed"), eq(users.status, "active")));

  const activePairings = await db.select().from(nemesisPairings).where(eq(nemesisPairings.status, "active"));
  const busy = new Set(activePairings.flatMap((p) => [p.userA, p.userB]));

  const candidates: NemesisCandidate[] = [];
  for (const u of claimed) {
    if (busy.has(u.id)) continue;
    const picksForUser = await resolvedCompetitivePicks(db, u.id);
    if (picksForUser.length < CONSTANTS.NEMESIS_MIN_PICKS) continue;
    const wins = picksForUser.filter((p) => p.result === "win").length;
    const accuracy = wins / picksForUser.length;
    const chalk =
      picksForUser.reduce((sum, p) => sum + Number(p.entryPrice), 0) / picksForUser.length;
    candidates.push({ userId: u.id, accuracy, chalk });
  }
  return candidates;
}

export interface AssignedPairing {
  id: string;
  userA: string;
  userB: string;
}

/** §7.11.3/§16.5: admin-triggered assignment (not a weekly cron at MVP scope). */
export async function assignNemeses(now: Date): Promise<AssignedPairing[]> {
  const candidates = await eligibleNemesisCandidates();
  const pairs = matchNemeses(candidates);
  const weekStart = etDateStr(now);

  const created: AssignedPairing[] = [];
  for (const pair of pairs) {
    const [userA, userB] = [pair.userA, pair.userB].sort();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(nemesisPairings)
        .values({ weekStart, userA, userB })
        .returning();
      // nemesis_members PK makes double-pairing impossible under retries.
      await tx
        .insert(nemesisMembers)
        .values([
          { weekStart, userId: userA, pairingId: row.id },
          { weekStart, userId: userB, pairingId: row.id },
        ])
        .onConflictDoNothing();
      created.push({ id: row.id, userA, userB });
    });
  }
  return created;
}

/**
 * §7.11.4 scoring, MVP form: called after a daily question reveals.
 * For every active pairing where both members answered THIS question
 * and it hasn't been counted yet, count it (score + edge), up to
 * NEMESIS_MATCH_QUESTIONS. At the cap, finalize the verdict.
 */
export async function updateNemesisPairingsOnReveal(questionId: string, now: Date): Promise<void> {
  const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  if (!question || question.kind !== "daily") return;

  const activePairings = await db.select().from(nemesisPairings).where(eq(nemesisPairings.status, "active"));

  for (const pairing of activePairings) {
    const alreadyCounted = await db
      .select()
      .from(nemesisMatchQuestions)
      .where(
        and(eq(nemesisMatchQuestions.pairingId, pairing.id), eq(nemesisMatchQuestions.questionId, questionId))
      )
      .limit(1);
    if (alreadyCounted.length > 0) continue;

    const bothPicks = await db
      .select()
      .from(picks)
      .where(and(eq(picks.questionId, questionId), inArray(picks.userId, [pairing.userA, pairing.userB])));
    const pickA = bothPicks.find((p) => p.userId === pairing.userA);
    const pickB = bothPicks.find((p) => p.userId === pairing.userB);
    if (!pickA || !pickB || pickA.result === "void") continue; // both must have answered, and it must have resolved

    await db.transaction(async (tx) => {
      await tx.insert(nemesisMatchQuestions).values({ pairingId: pairing.id, questionId }).onConflictDoNothing();

      const aWon = pickA.result === "win" ? 1 : 0;
      const bWon = pickB.result === "win" ? 1 : 0;
      const edgeADelta = (aWon ? 1 : 0) - Number(pickA.entryPrice);
      const edgeBDelta = (bWon ? 1 : 0) - Number(pickB.entryPrice);

      const newScoreA = pairing.scoreA + aWon;
      const newScoreB = pairing.scoreB + bWon;
      const newEdgeA = Number(pairing.edgeA) + edgeADelta;
      const newEdgeB = Number(pairing.edgeB) + edgeBDelta;

      const countedRows = await tx
        .select()
        .from(nemesisMatchQuestions)
        .where(eq(nemesisMatchQuestions.pairingId, pairing.id));
      const isComplete = countedRows.length >= CONSTANTS.NEMESIS_MATCH_QUESTIONS;

      let winner: "a" | "b" | "tie" | null = null;
      if (isComplete) {
        if (newScoreA > newScoreB) winner = "a";
        else if (newScoreB > newScoreA) winner = "b";
        else if (newEdgeA > newEdgeB) winner = "a";
        else if (newEdgeB > newEdgeA) winner = "b";
        else winner = "tie";
      }

      await tx
        .update(nemesisPairings)
        .set({
          scoreA: newScoreA,
          scoreB: newScoreB,
          edgeA: String(newEdgeA),
          edgeB: String(newEdgeB),
          status: isComplete ? "completed" : "active",
          winner,
        })
        .where(eq(nemesisPairings.id, pairing.id));
    });
  }
}
