/**
 * WS4-T6 AC (scorers): tie/void/exclusion branches for both scorers; synergy min-picks gate
 * (under and at/over 12 slots).
 */
import { describe, expect, it } from 'vitest';
import { SYNERGY_MIN_PICKS } from '@receipts/core';
import {
  computeDuoSynergy,
  resolveSameSideDay,
  scoreDuoMatch,
  scoreNemesisWeek,
} from '../src/scoring.js';
import type { DuoMatchQuestion, NemesisSharedQuestion, PlayerQuestionPick } from '../src/scoring.js';

const pick = (won: boolean, edge: number): PlayerQuestionPick => ({ picked: true, won, edge });
const noPick: PlayerQuestionPick = { picked: false, won: false, edge: 0 };

/** A same-side-aware pick (D-J4 inputs): side + entry cost (cents) + price stamp (ms). */
const ssPick = (
  side: 'yes' | 'no',
  entryCents: number,
  won: boolean,
  stampMs = 0,
  edge = 0,
): PlayerQuestionPick => ({ picked: true, won, edge, side, entryCents, priceStampedAtMs: stampMs });

describe('scoreNemesisWeek', () => {
  it('1 point iff picked AND won; no pick scores 0; both can score the same question', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, profileA: pick(true, 0.3), profileB: pick(true, 0.1) },
      { questionId: 'q2', isVoid: false, isSettled: true, profileA: pick(false, -0.2), profileB: noPick },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.scoreA).toBe(1); // won q1 only
    expect(result.scoreB).toBe(1); // won q1
    expect(result.excludedQuestionIds).toEqual([]);
  });

  it('excludes void questions from scoring and from Σedge', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'voided', isVoid: true, isSettled: true, profileA: pick(true, 0.5), profileB: pick(true, 0.5) },
      { questionId: 'q2', isVoid: false, isSettled: true, profileA: pick(true, 0.2), profileB: pick(false, -0.1) },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.excludedQuestionIds).toEqual(['voided']);
    expect(result.scoreA).toBe(1);
    expect(result.edgeA).toBeCloseTo(0.2, 10);
  });

  it('excludes unsettled-by-verdict-time questions', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'unsettled', isVoid: false, isSettled: false, profileA: pick(true, 0.9), profileB: noPick },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.excludedQuestionIds).toEqual(['unsettled']);
    expect(result.scoreA).toBe(0);
    expect(result.winner).toBe('draw');
  });

  it('tie in score -> higher Σedge wins', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, profileA: pick(true, 0.4), profileB: pick(true, 0.1) },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.scoreA).toBe(result.scoreB);
    expect(result.winner).toBe('a'); // higher edge
  });

  it('|Δedge| < 1e-4 -> draw, even with a tiny nonzero difference', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, profileA: pick(true, 0.500001), profileB: pick(true, 0.5) },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.winner).toBe('draw');
  });

  it('a real edge difference above the epsilon still resolves the tie', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, profileA: pick(true, 0.51), profileB: pick(true, 0.5) },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.winner).toBe('a');
  });

  it('higher score always wins over edge, even if the edge favors the other side', () => {
    const questions: NemesisSharedQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, profileA: pick(true, 0.01), profileB: noPick },
      { questionId: 'q2', isVoid: false, isSettled: true, profileA: noPick, profileB: pick(true, 0.99) },
      { questionId: 'q3', isVoid: false, isSettled: true, profileA: noPick, profileB: pick(true, 0.99) },
    ];
    const result = scoreNemesisWeek(questions);
    expect(result.scoreA).toBe(1);
    expect(result.scoreB).toBe(2);
    expect(result.winner).toBe('b');
  });
});

describe('resolveSameSideDay (D-J4, WS20-T1)', () => {
  it('returns null when not a same-side day (solo pick, opposite sides, or missing price data)', () => {
    expect(resolveSameSideDay(ssPick('yes', 40, true), noPick)).toBeNull();
    expect(resolveSameSideDay(ssPick('yes', 40, true), ssPick('no', 40, false))).toBeNull();
    // both picked same side but no price data → fall back to old rule
    expect(resolveSameSideDay(pick(true, 0.3), pick(true, 0.1))).toBeNull();
  });

  it('cheaper entry wins the day, independent of outcome (both-right AND both-wrong)', () => {
    // both right, yes side: 40¢ beats 55¢
    expect(resolveSameSideDay(ssPick('yes', 40, true), ssPick('yes', 55, true)).winner).toBe('a');
    // both wrong, yes side: 40¢ (smaller loss) still beats 55¢
    expect(resolveSameSideDay(ssPick('yes', 40, false), ssPick('yes', 55, false)).winner).toBe('a');
    // no side, b cheaper
    expect(resolveSameSideDay(ssPick('no', 70, true), ssPick('no', 30, false)).winner).toBe('b');
  });

  it('equal price → earlier minute-truncated stamp wins; same minute → draw', () => {
    // a stamped 09:00:59, b at 09:01:10 → different minutes, a earlier
    expect(resolveSameSideDay(ssPick('yes', 50, true, 59_000), ssPick('yes', 50, false, 70_000)).winner).toBe('a');
    // both within the same minute (0–59s) → genuine draw
    expect(resolveSameSideDay(ssPick('yes', 50, true, 10_000), ssPick('yes', 50, false, 40_000)).winner).toBe('draw');
    // b earlier minute
    expect(resolveSameSideDay(ssPick('no', 50, false, 130_000), ssPick('no', 50, true, 10_000)).winner).toBe('b');
  });
});

describe('scoreNemesisWeek — same-side days (D-J4)', () => {
  it('same-side both-won day → cheaper entry wins the day 1–0 (not the old 1–1 push)', () => {
    const r = scoreNemesisWeek([
      { questionId: 'q', isVoid: false, isSettled: true, profileA: ssPick('yes', 40, true, 0, 0.3), profileB: ssPick('yes', 60, true, 0, 0.1) },
    ]);
    expect([r.scoreA, r.scoreB]).toEqual([1, 0]);
  });

  it('same-side both-wrong day → smaller loss wins 1–0 (not the old 0–0 dead day)', () => {
    const r = scoreNemesisWeek([
      { questionId: 'q', isVoid: false, isSettled: true, profileA: ssPick('no', 65, false), profileB: ssPick('no', 35, false) },
    ]);
    expect([r.scoreA, r.scoreB]).toEqual([0, 1]);
  });

  it('same-side equal-price same-minute → draw day (0–0), Σedge still accrues for the week', () => {
    const r = scoreNemesisWeek([
      { questionId: 'q', isVoid: false, isSettled: true, profileA: ssPick('yes', 50, true, 5_000, 0.4), profileB: ssPick('yes', 50, true, 20_000, 0.2) },
    ]);
    expect([r.scoreA, r.scoreB]).toEqual([0, 0]);
    expect(r.edgeA).toBeCloseTo(0.4, 10);
    expect(r.edgeB).toBeCloseTo(0.2, 10);
    expect(r.winner).toBe('a'); // score tie → higher Σedge
  });

  it('void same-side day is excluded (no winner, no Σedge)', () => {
    const r = scoreNemesisWeek([
      { questionId: 'v', isVoid: true, isSettled: true, profileA: ssPick('yes', 40, true, 0, 0.5), profileB: ssPick('yes', 60, true, 0, 0.5) },
    ]);
    expect(r.excludedQuestionIds).toEqual(['v']);
    expect([r.scoreA, r.scoreB]).toEqual([0, 0]);
  });

  it('opposite-side day is byte-identical to the pre-D-J4 rule even with price data present', () => {
    // A picks yes and wins, B picks no and loses → exactly one point, as before.
    const withPrices = scoreNemesisWeek([
      { questionId: 'q', isVoid: false, isSettled: true, profileA: ssPick('yes', 40, true, 0, 0.3), profileB: ssPick('no', 60, false, 0, -0.2) },
    ]);
    const legacy = scoreNemesisWeek([
      { questionId: 'q', isVoid: false, isSettled: true, profileA: pick(true, 0.3), profileB: pick(false, -0.2) },
    ]);
    expect([withPrices.scoreA, withPrices.scoreB]).toEqual([legacy.scoreA, legacy.scoreB]);
    expect([withPrices.scoreA, withPrices.scoreB]).toEqual([1, 0]);
  });
});

describe('scoreDuoMatch', () => {
  const duoPicks = (p1: PlayerQuestionPick, p2: PlayerQuestionPick) => ({ partner1: p1, partner2: p2 });

  it('duo points = count of partners who both picked and won (0-2)', () => {
    const questions: DuoMatchQuestion[] = [
      {
        questionId: 'q1',
        isVoid: false,
        isSettled: true,
        duoA: duoPicks(pick(true, 0.2), pick(true, 0.1)), // both won -> 2
        duoB: duoPicks(pick(false, -0.1), noPick), // 0
      },
    ];
    const result = scoreDuoMatch(questions);
    expect(result.scoreA).toBe(2);
    expect(result.scoreB).toBe(0);
  });

  it('excludes void and unsettled questions', () => {
    const questions: DuoMatchQuestion[] = [
      { questionId: 'void', isVoid: true, isSettled: true, duoA: duoPicks(pick(true, 1), pick(true, 1)), duoB: duoPicks(pick(true, 1), pick(true, 1)) },
      { questionId: 'unsettled', isVoid: false, isSettled: false, duoA: duoPicks(pick(true, 1), pick(true, 1)), duoB: duoPicks(pick(true, 1), pick(true, 1)) },
      { questionId: 'graded', isVoid: false, isSettled: true, duoA: duoPicks(pick(true, 0.3), noPick), duoB: duoPicks(noPick, noPick) },
    ];
    const result = scoreDuoMatch(questions);
    expect(result.excludedQuestionIds.sort()).toEqual(['unsettled', 'void']);
    expect(result.scoreA).toBe(1);
    expect(result.scoreB).toBe(0);
  });

  it('tie in score -> higher Σedge over the duo\'s own picks; |Δedge|<1e-4 -> draw', () => {
    const tiedQuestions: DuoMatchQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, duoA: duoPicks(pick(true, 0.3), noPick), duoB: duoPicks(pick(true, 0.1), noPick) },
    ];
    const tied = scoreDuoMatch(tiedQuestions);
    expect(tied.scoreA).toBe(tied.scoreB);
    expect(tied.winner).toBe('a');

    const drawQuestions: DuoMatchQuestion[] = [
      { questionId: 'q1', isVoid: false, isSettled: true, duoA: duoPicks(pick(true, 0.500001), noPick), duoB: duoPicks(pick(true, 0.5), noPick) },
    ];
    const draw = scoreDuoMatch(drawQuestions);
    expect(draw.winner).toBe('draw');
  });
});

describe('computeDuoSynergy', () => {
  it('returns null synergy below SYNERGY_MIN_PICKS slots', () => {
    const slots = Array.from({ length: SYNERGY_MIN_PICKS - 1 }, (_, i) => ({ won: i % 2 === 0 }));
    const result = computeDuoSynergy({ slots, partnerAAccuracy: 0.5, partnerBAccuracy: 0.5 });
    expect(result.totalSlots).toBe(SYNERGY_MIN_PICKS - 1);
    expect(result.synergy).toBeNull();
    // jointHitRate/expected are still computed, only the display gate is on synergy
    expect(result.jointHitRate).toBeCloseTo(6 / 11, 10);
  });

  it('computes synergy = joint - expected at exactly SYNERGY_MIN_PICKS slots', () => {
    const slots = Array.from({ length: SYNERGY_MIN_PICKS }, (_, i) => ({ won: i < 8 })); // 8/12 win
    const result = computeDuoSynergy({ slots, partnerAAccuracy: 0.5, partnerBAccuracy: 0.6 });
    expect(result.totalSlots).toBe(SYNERGY_MIN_PICKS);
    const expectedJoint = 8 / 12;
    const expectedExpected = (0.5 + 0.6) / 2;
    expect(result.jointHitRate).toBeCloseTo(expectedJoint, 10);
    expect(result.expected).toBeCloseTo(expectedExpected, 10);
    expect(result.synergy).toBeCloseTo(expectedJoint - expectedExpected, 10);
  });

  it('missing picks and voids create no slot — caller must not include them', () => {
    // 0 slots -> no NaN, jointHitRate=0, synergy null (well below the gate)
    const result = computeDuoSynergy({ slots: [], partnerAAccuracy: 0.4, partnerBAccuracy: 0.4 });
    expect(result.totalSlots).toBe(0);
    expect(result.jointHitRate).toBe(0);
    expect(result.synergy).toBeNull();
  });
});
