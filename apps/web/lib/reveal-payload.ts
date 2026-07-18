/**
 * Assembles the §6.7 `RevealPayload` for `GET /questions/:slug/reveal` (WS3-T4). Only called
 * once the question is ACTUALLY `revealed` (the route gates on the raw status — publication
 * rule, §6.5/§6.7 — before ever reaching this builder).
 */
import type { Redis } from 'ioredis';
import { isCalledIt } from '@receipts/engine';
import {
  getFreezeUsesForProfile,
  getPick,
  getProfileById,
  getPicksForProfile,
  listRevealedOrVoidedDailyThrough,
  replayStreak,
  type Db,
  type MarketRow,
  type QuestionRow,
} from '@receipts/db';
import { addDaysToDateString, type RevealPayload, type RevealViewer } from '@receipts/core';
import { serializeQuestionPublic } from './serialize-question';
import { serializePick } from './serialize-pick';
import { getViewerPercentile } from './percentile';

/**
 * "Delta"/"freeze_used" aren't columns anywhere — `profiles` only holds current state. Both are
 * reconstructed on demand by replaying the profile's history up to (excluding) `questionDate`
 * and diffing against the (already-updated-by-reveal:fire) current state — no separate
 * per-reveal ledger needed (reuses `streak-replay.ts`, not re-derived).
 */
async function computeViewerStreakBlock(
  db: Db,
  profile: { id: string; currentStreak: number; bestStreak: number },
  questionDate: string,
): Promise<RevealViewer['streak']> {
  const dayBefore = addDaysToDateString(questionDate, -1);
  const [historyBefore, picks, freezeUses] = await Promise.all([
    listRevealedOrVoidedDailyThrough(db, dayBefore),
    getPicksForProfile(db, profile.id),
    getFreezeUsesForProfile(db, profile.id),
  ]);
  const before = replayStreak(historyBefore, picks, freezeUses);
  const delta = profile.currentStreak - before.currentStreak;
  const freezeUsed =
    before.lastCountedDate !== null &&
    freezeUses.some((f) => f.coveredDate > before.lastCountedDate! && f.coveredDate < questionDate);

  return { current: profile.currentStreak, best: profile.bestStreak, delta, freeze_used: freezeUsed };
}

/**
 * SPEC-GAP(WS3-T4): §13.3's beat catalog has no entry for a general daily-reveal crowd
 * narrative (its beats are nemesis/duo/streak-specific) — this is a minimal deterministic
 * placeholder, not a `packages/engine` beat, pending a copy pass (§10.6/WS14-T3).
 */
function buildNarrativeLine(question: QuestionRow, crowdPctYes: number): string {
  const winningLabel = question.outcome === 'yes' ? question.yesLabel : question.noLabel;
  const crowdPickedYes = crowdPctYes >= 50;
  const crowdWasRight = (crowdPickedYes && question.outcome === 'yes') || (!crowdPickedYes && question.outcome === 'no');
  const crowdSidePct = Math.round(crowdPickedYes ? crowdPctYes : 100 - crowdPctYes);
  return crowdWasRight
    ? `${crowdSidePct}% called it. ${winningLabel} it is.`
    : `${crowdSidePct}% had it wrong. ${winningLabel} came through instead.`;
}

export interface BuildRevealPayloadArgs {
  db: Db;
  redis: Redis;
  question: QuestionRow;
  market: MarketRow;
  viewerProfileId: string | null;
  appUrl: string;
  at: Date;
}

export async function buildRevealPayload(args: BuildRevealPayloadArgs): Promise<RevealPayload> {
  const { db, redis, question, market, viewerProfileId, appUrl, at } = args;
  if (question.status !== 'revealed' || !question.outcome) {
    throw new Error(`buildRevealPayload: question ${question.id} is not revealed`);
  }

  const questionPublic = serializeQuestionPublic(question, market, at);
  const yes = question.crowdYesAtLock ?? 0;
  const no = question.crowdNoAtLock ?? 0;
  const crowd = { yes, no, pct_yes: yes + no === 0 ? 0 : (yes / (yes + no)) * 100 };

  let viewer: RevealViewer | undefined;
  if (viewerProfileId) {
    const pick = await getPick(db, question.id, viewerProfileId);
    if (pick && pick.result !== 'pending' && pick.result !== 'void') {
      const profile = await getProfileById(db, viewerProfileId);
      if (profile) {
        const percentile = await getViewerPercentile(db, redis, question.id, viewerProfileId);
        const impliedProb = pick.side === 'yes' ? pick.yesPriceAtEntry : 1 - pick.yesPriceAtEntry;
        const badges: RevealViewer['badges'] = pick.result === 'win' && isCalledIt(impliedProb) ? ['called_it'] : [];
        const streak = question.questionDate
          ? await computeViewerStreakBlock(db, profile, question.questionDate)
          : { current: profile.currentStreak, best: profile.bestStreak, delta: 0, freeze_used: false };

        viewer = {
          pick: serializePick(pick),
          result: pick.result,
          edge: pick.edge,
          percentile,
          streak,
          badges,
        };
      }
    }
  }

  return {
    question: questionPublic,
    outcome: question.outcome,
    crowd,
    viewer,
    narrative_line: buildNarrativeLine(question, crowd.pct_yes),
    share: {
      page_url: `${appUrl}/q/${question.slug}`,
      og_url: `${appUrl}/api/og/q/${question.slug}`,
      card_urls: [],
    },
  };
}
