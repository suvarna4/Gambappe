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
import { questionOgHash } from './og/entities';

/**
 * "Delta"/"freeze_used" aren't columns anywhere — `profiles` only holds LIVE current state,
 * which can already reflect days AFTER `questionDate` by the time a viewer opens this reveal
 * (subsequent reveals/sweeps keep mutating `profiles.current_streak`). Both are instead
 * reconstructed by replaying up to and including `questionDate` (`after`) and up to but
 * excluding it (`before`), and diffing the two — never the live profile row (reuses
 * `streak-replay.ts`, not re-derived).
 */
async function computeViewerStreakBlock(
  db: Db,
  profileId: string,
  questionDate: string,
): Promise<RevealViewer['streak']> {
  const dayBefore = addDaysToDateString(questionDate, -1);
  const [historyBefore, historyThrough, picks, freezeUses] = await Promise.all([
    listRevealedOrVoidedDailyThrough(db, dayBefore),
    listRevealedOrVoidedDailyThrough(db, questionDate),
    getPicksForProfile(db, profileId),
    getFreezeUsesForProfile(db, profileId),
  ]);
  const before = replayStreak(historyBefore, picks, freezeUses);
  const after = replayStreak(historyThrough, picks, freezeUses);
  const delta = after.currentStreak - before.currentStreak;

  // NOT `before.lastCountedDate`: replayStreak's non-participant branch ADVANCES
  // lastCountedDate across every freeze-covered gap day, so by the time replay finishes it
  // already sits at (or past) any freeze-covered date before `questionDate` — the strict
  // `coveredDate > lastCountedDate` check below could then never match the freeze that
  // actually bridged today's gap. Anchor on the last daily the profile truly ANSWERED
  // instead (mirrors replayStreak's own `answered` predicate: a non-void pick on a revealed,
  // not voided, daily) — freeze coverage between that date and today is what "freeze_used"
  // for this reveal means.
  const pickByQuestionId = new Map(picks.map((p) => [p.questionId, p] as const));
  const lastAnsweredDate = historyBefore
    .filter((q) => q.status === 'revealed')
    .filter((q) => {
      const pick = pickByQuestionId.get(q.id);
      return pick !== undefined && pick.result !== 'void';
    })
    .map((q) => q.questionDate)
    .sort()
    .at(-1);
  const freezeUsed = freezeUses.some(
    (f) => (lastAnsweredDate === undefined || f.coveredDate > lastAnsweredDate) && f.coveredDate < questionDate,
  );

  return { current: after.currentStreak, best: after.bestStreak, delta, freeze_used: freezeUsed };
}

/**
 * SPEC-GAP(WS3-T4): §13.3's beat catalog has no entry for a general daily-reveal crowd
 * narrative (its beats are nemesis/duo/streak-specific) — this is a minimal deterministic
 * placeholder, not a `packages/engine` beat, pending a copy pass (§10.6/WS14-T3).
 */
function buildNarrativeLine(question: QuestionRow, crowdYes: number, crowdNo: number): string {
  const winningLabel = question.outcome === 'yes' ? question.yesLabel : question.noLabel;
  // No crowd at all (degenerate: revealed with zero lock-snapshot picks) → there's no honest
  // "N% called it / had it wrong" to attribute, so just state the outcome.
  const total = crowdYes + crowdNo;
  if (total === 0) return `${winningLabel} it is.`;
  // Majority from the raw COUNTS, never a rounded percent (49.6% rounds to 50 and would flip
  // which side the narrative attributes to the crowd). Non-zero tie → yes side, matching the
  // old `pct >= 50` behavior exactly.
  const crowdPickedYes = crowdYes >= crowdNo;
  const crowdWasRight = (crowdPickedYes && question.outcome === 'yes') || (!crowdPickedYes && question.outcome === 'no');
  const crowdSideCount = crowdPickedYes ? crowdYes : crowdNo;
  const crowdSidePct = Math.round((crowdSideCount / total) * 100);
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
  // Rounded for the same reason `serializeQuestionPublic`'s crowd block is — every display of
  // pct_yes is an integer percent; majority logic (buildNarrativeLine) reads the raw counts.
  const crowd = { yes, no, pct_yes: yes + no === 0 ? 0 : Math.round((yes / (yes + no)) * 100) };

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
          ? await computeViewerStreakBlock(db, profile.id, question.questionDate)
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

  // Canonical content-addressed share URLs (§10.5): the real routes are /api/og/question and
  // /api/cards/question (the drill found the old /api/og/q/ path 404s — WS14-T4 finding), and
  // carrying the exact `?v=` state hash means consumers hit the CDN-cached render directly
  // instead of bouncing through the guard's 302. Param order matches ogVersionGuard's canonical
  // redirect target (`format` first, `v` appended) so these never redirect at all.
  const ogHash = questionOgHash(question, market.yesPrice ?? null);
  const cardBase = `${appUrl}/api/cards/question/${question.slug}`;

  return {
    question: questionPublic,
    outcome: question.outcome,
    crowd,
    viewer,
    narrative_line: buildNarrativeLine(question, yes, no),
    share: {
      page_url: `${appUrl}/q/${question.slug}`,
      og_url: `${appUrl}/api/og/question/${question.slug}?v=${ogHash}`,
      card_urls: [`${cardBase}?format=story&v=${ogHash}`, `${cardBase}?format=square&v=${ogHash}`],
    },
  };
}
