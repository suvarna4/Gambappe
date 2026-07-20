/**
 * SW10-T1 (wiring-gaps doc §4 SW10-T1, §11-§13 fable rounds 5-7): unit tests for the
 * `nemesis_flip` block's pure derivation helpers — `tallyScoreboard` and
 * `deriveNemesisFlipNarration`, exported from `apps/web/lib/reveal-payload.ts`. These are pure
 * functions of already-fetched scoreboard rows (no DB, no reveal-contract faking), which is why
 * this stays a plain Vitest unit test rather than an integration test — the SW9 "no mocks of the
 * reveal contract" rule (`obituary-wake.spec.ts`'s header) targets end-to-end TRIGGER tests, not
 * pure-function derivation helpers; the tally-correctness and pre-reveal-unreachability ACs still
 * get real-Postgres integration coverage (`test/integration/nemesis-flip-payload.test.ts`), and
 * the full trigger gets real-HTTP e2e coverage (`e2e/nemesis-flip.spec.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { PairingScoreboardRow } from '@/lib/nemesis/types';
import { deriveNemesisFlipNarration, tallyScoreboard } from '@/lib/reveal-payload';

function row(overrides: {
  questionId?: string;
  questionDate?: string | null;
  a?: { side: 'yes' | 'no'; result: 'pending' | 'win' | 'loss' | 'void' } | null;
  b?: { side: 'yes' | 'no'; result: 'pending' | 'win' | 'loss' | 'void' } | null;
}): PairingScoreboardRow {
  return {
    question_id: (overrides.questionId ?? 'q-default') as PairingScoreboardRow['question_id'],
    slug: 'test-slug',
    kind: 'daily',
    question_date: overrides.questionDate ?? null,
    a: overrides.a ?? null,
    b: overrides.b ?? null,
  };
}

describe('tallyScoreboard (§8.8 independent accrual)', () => {
  it('counts each side\'s result === "win" rows, viewer-relative when viewer is side a', () => {
    const rows = [
      row({ a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
      row({ a: { side: 'no', result: 'loss' }, b: { side: 'yes', result: 'win' } }),
      row({ a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
    ];
    expect(tallyScoreboard(rows, true)).toEqual({ you: 2, opponent: 1 });
  });

  it('flips you/opponent when the viewer is side b', () => {
    const rows = [
      row({ a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
      row({ a: { side: 'no', result: 'loss' }, b: { side: 'yes', result: 'win' } }),
    ];
    expect(tallyScoreboard(rows, false)).toEqual({ you: 1, opponent: 1 });
  });

  it('skips pending/void/loss rows — only "win" counts, never `pairing.score_a/b`', () => {
    const rows = [
      row({ a: { side: 'yes', result: 'pending' }, b: { side: 'no', result: 'pending' } }),
      row({ a: { side: 'yes', result: 'void' }, b: { side: 'no', result: 'void' } }),
      row({ a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ a: null, b: null }),
    ];
    expect(tallyScoreboard(rows, true)).toEqual({ you: 0, opponent: 1 });
  });
});

const NO_SCOREBOARD: PairingScoreboardRow[] = [];

describe('deriveNemesisFlipNarration — nemesis_lead_taken', () => {
  it('emits when a tied week flips to the viewer leading', () => {
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard: NO_SCOREBOARD,
      viewerIsA: true,
      questionDate: '2026-07-16',
      before: { you: 1, opponent: 1 },
      after: { you: 2, opponent: 1 },
      questionsLeft: 3,
    });
    expect(line).toBe('You takes the lead, 2–1, with 3 questions left.');
  });

  it('emits when the leader flips from the opponent to the viewer', () => {
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard: NO_SCOREBOARD,
      viewerIsA: true,
      questionDate: '2026-07-16',
      before: { you: 1, opponent: 2 },
      after: { you: 3, opponent: 2 },
      questionsLeft: 1,
    });
    expect(line).toBe('You takes the lead, 3–2, with 1 questions left.');
  });

  it('names the OPPONENT as leader when they take the lead', () => {
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard: NO_SCOREBOARD,
      viewerIsA: true,
      questionDate: '2026-07-16',
      before: { you: 1, opponent: 1 },
      after: { you: 1, opponent: 2 },
      questionsLeft: 2,
    });
    expect(line).toBe('Maria O. takes the lead, 2–1, with 2 questions left.');
  });

  it('emits nothing when the leader did not change (no flip)', () => {
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard: NO_SCOREBOARD,
      viewerIsA: true,
      questionDate: '2026-07-16',
      before: { you: 2, opponent: 0 },
      after: { you: 3, opponent: 0 },
      questionsLeft: 2,
    });
    expect(line).toBeNull();
  });
});

describe('deriveNemesisFlipNarration — nemesis_comeback', () => {
  it('emits when the viewer was down >= 2 at some point and the week is now level', () => {
    // day1 (Mon): opponent wins. day2 (Tue): opponent wins again -> viewer down 2 (the peak).
    // day3 (Wed): viewer wins. day4 (Thu, today): viewer wins -> level 2-2.
    const scoreboard = [
      row({ questionId: 'd1', questionDate: '2026-07-13', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'd2', questionDate: '2026-07-14', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'd3', questionDate: '2026-07-15', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
      row({ questionId: 'd4', questionDate: '2026-07-16', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
    ];
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard,
      viewerIsA: true,
      questionDate: '2026-07-16',
      before: { you: 1, opponent: 2 },
      after: { you: 2, opponent: 2 },
      questionsLeft: 0,
    });
    expect(line).toBe('Down two on Tuesday. Level on Thursday. You is not done.');
  });

  it('never fires for a 1-point deficit (numberWord has no entry for 1)', () => {
    const scoreboard = [
      row({ questionId: 'd1', questionDate: '2026-07-13', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'd2', questionDate: '2026-07-14', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
    ];
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard,
      viewerIsA: true,
      questionDate: '2026-07-14',
      before: { you: 0, opponent: 1 },
      after: { you: 1, opponent: 1 },
      questionsLeft: 0,
    });
    expect(line).toBeNull();
  });

  it("an OPPONENT's comeback to level emits nothing (viewer-relative deficit never goes positive)", () => {
    // Viewer builds a 2-0 lead, then the opponent claws back to level — this is the OPPONENT's
    // comeback, not the viewer's, and must not narrate.
    const scoreboard = [
      row({ questionId: 'd1', questionDate: '2026-07-13', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
      row({ questionId: 'd2', questionDate: '2026-07-14', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
      row({ questionId: 'd3', questionDate: '2026-07-15', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'd4', questionDate: '2026-07-16', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
    ];
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard,
      viewerIsA: true,
      questionDate: '2026-07-16',
      before: { you: 2, opponent: 1 },
      after: { you: 2, opponent: 2 },
      questionsLeft: 0,
    });
    expect(line).toBeNull();
  });

  it('degrades to null when the daily-only trace disagrees with the full after-tally on level (null-date rule)', () => {
    // Daily rows alone end 0-1 (not level); a nemesis-bonus row (question_date: null) gives the
    // viewer a win, making the FULL after-tally 1-1 (level) — the trace can't be trusted to
    // place that win in the running order, so this must degrade to null rather than guess.
    const scoreboard = [
      row({ questionId: 'd1', questionDate: '2026-07-13', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'bonus', questionDate: null, a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
    ];
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard,
      viewerIsA: true,
      questionDate: '2026-07-13',
      before: { you: 0, opponent: 0 },
      after: { you: 1, opponent: 1 },
      questionsLeft: 0,
    });
    expect(line).toBeNull();
  });

  it('degrades to null when the peak is real but the levelDay (today) has no calendar date', () => {
    const scoreboard = [
      row({ questionId: 'd1', questionDate: '2026-07-13', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'd2', questionDate: '2026-07-14', a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } }),
      row({ questionId: 'd3', questionDate: '2026-07-15', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
      row({ questionId: 'd4', questionDate: '2026-07-16', a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'loss' } }),
    ];
    const line = deriveNemesisFlipNarration({
      viewerHandle: 'You',
      opponentHandle: 'Maria O.',
      scoreboard,
      viewerIsA: true,
      questionDate: null, // today's own question is an undated nemesis-bonus round
      before: { you: 1, opponent: 2 },
      after: { you: 2, opponent: 2 },
      questionsLeft: 0,
    });
    expect(line).toBeNull();
  });
});
