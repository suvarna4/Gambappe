/**
 * Assembles the §6.7 `RevealPayload` for `GET /questions/:slug/reveal` (WS3-T4). Only called
 * once the question is ACTUALLY `revealed` (the route gates on the raw status — publication
 * rule, §6.5/§6.7 — before ever reaching this builder).
 */
import type { Redis } from 'ioredis';
import { isCalledIt, narrate } from '@receipts/engine';
import {
  getFreezeUsesForProfile,
  getPick,
  getProfileById,
  getPicksForProfile,
  getQuestionById,
  listRevealedOrVoidedDailyThrough,
  replayStreak,
  type Db,
  type MarketRow,
  type PickRow,
  type QuestionRow,
  type ReplayDailyQuestion,
  type ReplayFreezeUse,
  type StreakReplayResult,
} from '@receipts/db';
import { addDaysToDateString, isFlagEnabled, type RevealPayload, type RevealViewer } from '@receipts/core';
import { getActiveDuoForProfile } from './duo-queue';
import { getCurrentPairingForProfile } from './nemesis/service';
import type { PairingScoreboardRow } from './nemesis/types';
import { serializeQuestionPublic } from './serialize-question';
import { serializePick } from './serialize-pick';
import { getViewerPercentile } from './percentile';
import { formatShortDate, formatWeekdayName } from './format-et';
import { questionOgHash } from './og/entities';

/**
 * "Delta"/"freeze_used" aren't columns anywhere — `profiles` only holds LIVE current state,
 * which can already reflect days AFTER `questionDate` by the time a viewer opens this reveal
 * (subsequent reveals/sweeps keep mutating `profiles.current_streak`). Both are instead
 * reconstructed by replaying up to and including `questionDate` (`after`) and up to but
 * excluding it (`before`), and diffing the two — never the live profile row (reuses
 * `streak-replay.ts`, not re-derived).
 */
type BrokenRunBlock = NonNullable<RevealViewer['streak']['broken_run']>;
type BrokenRunLastPick = NonNullable<BrokenRunBlock['last_pick']>;

/** Implied entry price of the HELD side, in integer cents (the receipt's "@ {c}¢"). */
function impliedEntryCents(pick: PickRow): number {
  return Math.round((pick.side === 'yes' ? pick.yesPriceAtEntry : 1 - pick.yesPriceAtEntry) * 100);
}

/**
 * SW9-T1 (obituary-handoff §3.2): the `broken_run` block. Emitted iff this reveal is the wake —
 * the viewer's first counted daily since a break — per the doc's MECHANICAL condition, both
 * values from the AFTER replay (the through-`questionDate` one; the before-replay can never
 * satisfy it): `runs.length > 0 && currentRunStartedOn === questionDate`. No calendar-adjacency
 * check between the dead run and the live one (a death requires >= 1 uncovered revealed day
 * strictly between them, so "ended the day before" is always false); run-sequence adjacency is
 * automatic. The first-ever-pick case is excluded by `runs.length > 0` (§3.1's zero-guard is
 * what makes that exclusion sound). No length threshold server-side — `OBITUARY_MIN_STREAK`
 * stays a client presentation rule.
 */
async function computeBrokenRunBlock(
  db: Db,
  after: StreakReplayResult,
  historyThrough: ReplayDailyQuestion[],
  picks: PickRow[],
  freezeUses: ReplayFreezeUse[],
  questionDate: string,
): Promise<BrokenRunBlock | null> {
  if (!(after.runs.length > 0 && after.currentRunStartedOn === questionDate)) return null;
  const deadRun = after.runs.at(-1)!;

  // The dead run's ANSWERED days (replayStreak's own `answered` predicate: a non-void pick on a
  // revealed daily), date-ascending. §3.1: `endedOn` itself can be a voided or freeze-covered
  // date the viewer never picked, so "last pick" is the latest answered date <= endedOn within
  // the run — never "the pick on endedOn".
  const pickByQuestionId = new Map(picks.map((p) => [p.questionId, p] as const));
  const runAnsweredPicks = historyThrough
    .filter(
      (q) =>
        q.status === 'revealed' &&
        q.questionDate >= deadRun.startedOn &&
        q.questionDate <= deadRun.endedOn,
    )
    .sort((a, b) => a.questionDate.localeCompare(b.questionDate))
    .map((q) => ({ question: q, pick: pickByQuestionId.get(q.id) }))
    .filter((e): e is { question: ReplayDailyQuestion; pick: PickRow } => e.pick !== undefined && e.pick.result !== 'void');

  // "Died holding {SIDE} @ {c}¢" — side_label needs the death question's own labels (one extra
  // fetch by id); pick_id/entry_cents/question_slug come from data already in hand. Null when
  // unresolvable → the UI omits the line (SW4-T1 degrade rule).
  let lastPick: BrokenRunBlock['last_pick'] = null;
  const finalAnswered = runAnsweredPicks.at(-1);
  if (finalAnswered) {
    const deathQuestion = await getQuestionById(db, finalAnswered.question.id);
    // A null slug (nullable column, though never for a real daily) makes the share path
    // unbuildable — treat it as unresolvable and degrade to null (SW4-T1 rule).
    if (deathQuestion && deathQuestion.slug) {
      lastPick = {
        pick_id: finalAnswered.pick.id as BrokenRunLastPick['pick_id'],
        side_label: finalAnswered.pick.side === 'yes' ? deathQuestion.yesLabel : deathQuestion.noLabel,
        entry_cents: impliedEntryCents(finalAnswered.pick),
        question_slug: deathQuestion.slug,
      };
    }
  }

  // §3.1: half-open interval (startedOn, endedOn] — the tail-covered case means the boundary
  // date belongs to the run. No "burned on the fatal gap" class: every covered prefix of a
  // would-be-fatal gap is absorbed into the run (advancing endedOn), the killing date is by
  // definition uncovered, and streak:sweep only processes positive streaks — nothing burns
  // after death.
  const freezesSurvived = freezeUses.filter(
    (f) => f.coveredDate > deadRun.startedOn && f.coveredDate <= deadRun.endedOn,
  ).length;

  const oddsCents = runAnsweredPicks.map((e) => impliedEntryCents(e.pick));

  return {
    length: deadRun.length,
    started_on: deadRun.startedOn,
    ended_on: deadRun.endedOn,
    last_pick: lastPick,
    freezes_survived: freezesSurvived,
    longest_odds_cents: oddsCents.length > 0 ? Math.min(...oddsCents) : null,
  };
}

// --- SW10-T1: nemesis daily flip (wiring-gaps doc §4 SW10-T1) ---------------------------------

type NemesisFlipBlock = NonNullable<RevealViewer['nemesis_flip']>;

/** Viewer-relative win tally over a set of scoreboard rows (§8.8's independent accrual, NEVER
 * `pairing.score_a`/`score_b` — those default 0 until the week concludes). Exported for direct
 * unit testing (kept a pure function of already-fetched scoreboard rows, no DB/contract faking —
 * distinct from the SW9 "no mocks of the reveal contract" rule, which targets end-to-end trigger
 * tests, not this kind of pure derivation helper). */
export function tallyScoreboard(
  rows: readonly PairingScoreboardRow[],
  viewerIsA: boolean,
): { you: number; opponent: number } {
  let aWins = 0;
  let bWins = 0;
  for (const row of rows) {
    if (row.a?.result === 'win') aWins += 1;
    if (row.b?.result === 'win') bWins += 1;
  }
  return viewerIsA ? { you: aWins, opponent: bWins } : { you: bWins, opponent: aWins };
}

/**
 * The `nemesis_flip.narration` line (doc §4 SW10-T1, pinned across fable rounds 4-7): renders
 * ONLY via the existing `nemesis_lead_taken`/`nemesis_comeback` catalog beats. Returns `null`
 * when neither beat's trigger condition is met, or a required slot is unresolvable (degrade
 * rule — the UI omits the line). Exported for direct unit testing — see `tallyScoreboard`'s
 * comment on why a pure-function unit test here doesn't run afoul of the SW9 "no mocks of the
 * reveal contract" rule.
 */
export function deriveNemesisFlipNarration(args: {
  viewerHandle: string;
  opponentHandle: string;
  scoreboard: readonly PairingScoreboardRow[];
  viewerIsA: boolean;
  questionDate: string | null;
  after: { you: number; opponent: number };
  before: { you: number; opponent: number };
  questionsLeft: number;
}): string | null {
  const { viewerHandle, opponentHandle, scoreboard, viewerIsA, questionDate, after, before, questionsLeft } = args;

  if (after.you === after.opponent) {
    // Candidate: `nemesis_comeback` — viewer-relative running deficit over date-ordered
    // resolved DAILY rows only (round 7's null-date rule: nemesis-bonus rows have no defined
    // position in an order-dependent running sum).
    const dailyRows = scoreboard
      .filter((row): row is PairingScoreboardRow & { question_date: string } => row.question_date !== null)
      .slice()
      .sort((a, b) => a.question_date.localeCompare(b.question_date));

    let youTrace = 0;
    let opponentTrace = 0;
    let peak = 0;
    let peakDate: string | null = null;
    for (const row of dailyRows) {
      const yourSide = viewerIsA ? row.a : row.b;
      const opponentSide = viewerIsA ? row.b : row.a;
      if (yourSide?.result === 'win') youTrace += 1;
      if (opponentSide?.result === 'win') opponentTrace += 1;
      const deficit = opponentTrace - youTrace; // positive = viewer behind
      if (deficit > peak) {
        peak = deficit;
        peakDate = row.question_date;
      }
    }

    // Round 7 degrade rule: if the daily-only trace disagrees with the full after-tally on
    // whether the week is level, don't guess — the bonus-row contribution makes the trace
    // untrustworthy for this specific decision.
    if (youTrace !== opponentTrace) return null;
    if (peak < 2 || peakDate === null || questionDate === null) return null;

    return narrate({
      beat: 'nemesis_comeback',
      data: {
        handle: viewerHandle, // always the VIEWER's own handle — an opponent's comeback narrates nothing
        deficit: peak,
        downDay: formatWeekdayName(peakDate),
        levelDay: formatWeekdayName(questionDate),
      },
    }).line;
  }

  // Candidate: `nemesis_lead_taken` — emit only when today's grading flipped the leader.
  const afterLeader: 'you' | 'opponent' = after.you > after.opponent ? 'you' : 'opponent';
  const beforeLeader: 'you' | 'opponent' | 'tied' =
    before.you === before.opponent ? 'tied' : before.you > before.opponent ? 'you' : 'opponent';
  if (afterLeader === beforeLeader) return null;

  const leaderHandle = afterLeader === 'you' ? viewerHandle : opponentHandle;
  const leaderScore = afterLeader === 'you' ? after.you : after.opponent;
  const trailerScore = afterLeader === 'you' ? after.opponent : after.you;
  return narrate({
    beat: 'nemesis_lead_taken',
    data: { leaderHandle, leaderScore, trailerScore, questionsLeft },
  }).line;
}

/**
 * SW10-T1 (wiring-gaps doc §4 SW10-T1): the nemesis daily "flip" block. Lives inside the caller's
 * existing viewer gate — `buildRevealPayload` only reaches here for a graded, non-void OWN pick
 * on an ACTUALLY revealed question (the route 423s pre-reveal), so `getPick` for the opponent is
 * structurally unreachable before reveal, not merely unpopulated. Non-null iff (a) the viewer has
 * an active nemesis pairing this week and (b) the opponent has a pick on this exact question.
 */
async function computeNemesisFlipBlock(
  db: Db,
  question: QuestionRow,
  viewerProfileId: string,
  viewerHandle: string,
  at: Date,
): Promise<NemesisFlipBlock | null> {
  if (!isFlagEnabled('nemesis')) return null;

  const pairing = await getCurrentPairingForProfile(db, viewerProfileId, at);
  if (!pairing) return null;

  const viewerIsA = pairing.a.profile_id === viewerProfileId;
  const opponentRef = viewerIsA ? pairing.b : pairing.a;

  const opponentPick = await getPick(db, question.id, opponentRef.profile_id);
  if (!opponentPick) return null;

  const scoreboard = pairing.scoreboard;
  // Fable review of PR #85 round 2 (MEDIUM): without this, an archival reveal for a question
  // outside the pairing's current week (e.g. reached via the viewer's own obituary
  // `last_pick.question_slug` link) could still satisfy "opponent has a pick on this question" if
  // the opponent happened to pick it too on some other week, producing a negative/zero `dayNumber`
  // and a before/after tally that's a no-op for this question (so `nemesis_lead_taken` can never
  // fire, but `nemesis_comeback` still could, misattributing this week's comeback to a past date).
  // Require the question to actually be a row on THIS pairing's scoreboard.
  if (!scoreboard.some((row) => row.question_id === question.id)) return null;
  const after = tallyScoreboard(scoreboard, viewerIsA);
  const before = tallyScoreboard(
    scoreboard.filter((row) => row.question_id !== question.id),
    viewerIsA,
  );
  const questionsLeft = scoreboard.filter(
    (row) => row.a?.result === 'pending' || row.b?.result === 'pending',
  ).length;

  const narration = deriveNemesisFlipNarration({
    viewerHandle,
    opponentHandle: opponentRef.handle,
    scoreboard,
    viewerIsA,
    questionDate: question.questionDate,
    after,
    before,
    questionsLeft,
  });

  // "Week of {week_start} · Day {n}" — `n` is this question's 1-indexed offset into the pairing's
  // week (undated bonus questions have no defined day number, so the segment is dropped rather
  // than guessed).
  const dayNumber = question.questionDate
    ? Math.round(
        (Date.parse(`${question.questionDate}T00:00:00Z`) - Date.parse(`${pairing.week_start}T00:00:00Z`)) /
          86_400_000,
      ) + 1
    : null;
  const weekLabel = `Week of ${formatShortDate(pairing.week_start)}${dayNumber !== null ? ` · Day ${dayNumber}` : ''}`;

  return {
    opponent_handle: opponentRef.handle,
    opponent_side: opponentPick.side,
    opponent_side_label: opponentPick.side === 'yes' ? question.yesLabel : question.noLabel,
    opponent_entry_cents: impliedEntryCents(opponentPick),
    narration,
    you_wins: after.you,
    opponent_wins: after.opponent,
    week_label: weekLabel,
  };
}

// --- SW10-T3(b): duo shared-deck tandem block (wiring-gaps doc §4 SW10-T3) ---------------------

type DuoTandemBlock = NonNullable<RevealViewer['duo_tandem']>;

/**
 * SW10-T3(b) (wiring-gaps doc §4 SW10-T3): the duo tandem block. Lives inside the SAME caller
 * gate as `computeNemesisFlipBlock` above — `buildRevealPayload` only reaches here for a graded,
 * non-void OWN pick on an ACTUALLY revealed question, so `getPick` for the partner is
 * structurally unreachable before reveal, not merely unpopulated (identical guarantee, same
 * corrected reveal-time trigger as SW10-T1 — see that task's note for why the original pick-time
 * trigger was unimplementable). Non-null iff (a) the viewer has an active duo and (b) the
 * partner has a pick on this exact question.
 */
async function computeDuoTandemBlock(
  db: Db,
  question: QuestionRow,
  viewerProfileId: string,
): Promise<DuoTandemBlock | null> {
  if (!isFlagEnabled('duo_queue')) return null;

  const duo = await getActiveDuoForProfile(db, viewerProfileId);
  if (!duo) return null;

  const partnerId = duo.profileAId === viewerProfileId ? duo.profileBId : duo.profileAId;
  const partnerPick = await getPick(db, question.id, partnerId);
  if (!partnerPick) return null;

  const partner = await getProfileById(db, partnerId);
  if (!partner) return null;

  return {
    partner_handle: partner.handle,
    partner_side: partnerPick.side,
    partner_side_label: partnerPick.side === 'yes' ? question.yesLabel : question.noLabel,
  };
}

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
  const brokenRun = await computeBrokenRunBlock(db, after, historyThrough, picks, freezeUses, questionDate);

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

  return {
    current: after.currentStreak,
    best: after.bestStreak,
    delta,
    freeze_used: freezeUsed,
    broken_run: brokenRun,
  };
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
          : { current: profile.currentStreak, best: profile.bestStreak, delta: 0, freeze_used: false, broken_run: null };
        // SW10-T1: same reveal-time gate as `streak`/`broken_run` above — non-null only when an
        // active pairing exists AND the opponent has a pick on THIS question (see the function's
        // own doc comment for the "unreachable, not merely unpopulated" pre-reveal guarantee).
        const nemesisFlip = await computeNemesisFlipBlock(db, question, profile.id, profile.handle, at);
        // SW10-T3(b): same gate, independent block — a viewer can be in both a nemesis pairing
        // and a duo at once, so both sections are computed and rendered side by side, never
        // branched between (`RevealSequence`'s own comment on this).
        const duoTandem = await computeDuoTandemBlock(db, question, profile.id);

        viewer = {
          pick: serializePick(pick),
          result: pick.result,
          edge: pick.edge,
          percentile,
          streak,
          badges,
          nemesis_flip: nemesisFlip,
          duo_tandem: duoTandem,
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
