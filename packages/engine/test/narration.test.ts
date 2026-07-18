/**
 * WS4-T6 AC (narration): every beat has ≥1 win-side and ≥1 loss-side/negative golden string;
 * `called_it` boundary at exactly 0.20 implied probability.
 */
import { describe, expect, it } from 'vitest';
import { LONGSHOT_THRESHOLD } from '@receipts/core';
import { deriveStyleClause, isCalledIt, narrate } from '../src/narration.js';

describe('nemesis_assigned', () => {
  it('win-side: opponent chases longshots (chalk far below self)', () => {
    const result = narrate({
      beat: 'nemesis_assigned',
      data: {
        opponentHandle: 'Fox #4821',
        self: { chalk: 0.6, contrarian: 0, timing: 0 },
        opponent: { chalk: -0.6, contrarian: 0, timing: 0 },
      },
    });
    expect(result.line).toBe(
      "Meet Fox #4821. They chase longshots you'd never touch. You have seven days.",
    );
  });

  it('loss-side/negative: opponent sticks to favorites (chalk far above self)', () => {
    const result = narrate({
      beat: 'nemesis_assigned',
      data: {
        opponentHandle: 'Owl #1122',
        self: { chalk: -0.6, contrarian: 0, timing: 0 },
        opponent: { chalk: 0.6, contrarian: 0, timing: 0 },
      },
    });
    expect(result.line).toBe(
      'Meet Owl #1122. They stick to favorites more than you do. You have seven days.',
    );
  });
});

describe('nemesis_lead_taken', () => {
  it('win-side golden string', () => {
    const result = narrate({
      beat: 'nemesis_lead_taken',
      data: { leaderHandle: 'Wolf #99', leaderScore: 4, trailerScore: 2, questionsLeft: 3 },
    });
    expect(result.line).toBe('Wolf #99 takes the lead, 4–2, with 3 questions left.');
  });

  it('loss-side golden string (leader is the opponent)', () => {
    const result = narrate({
      beat: 'nemesis_lead_taken',
      data: { leaderHandle: 'Bear #4', leaderScore: 5, trailerScore: 1, questionsLeft: 1 },
    });
    expect(result.line).toBe('Bear #4 takes the lead, 5–1, with 1 questions left.');
  });
});

describe('nemesis_comeback', () => {
  it('win-side golden string, exact per §13.3 example', () => {
    const result = narrate({
      beat: 'nemesis_comeback',
      data: { handle: 'Otter #7', deficit: 2, downDay: 'Thursday', levelDay: 'Saturday' },
    });
    expect(result.line).toBe('Down two on Thursday. Level on Saturday. Otter #7 is not done.');
  });

  it('loss-side/negative: a larger deficit renders its number word', () => {
    const result = narrate({
      beat: 'nemesis_comeback',
      data: { handle: 'Lynx #2', deficit: 4, downDay: 'Monday', levelDay: 'Friday' },
    });
    expect(result.line).toBe('Down four on Monday. Level on Friday. Lynx #2 is not done.');
  });
});

describe('nemesis_last_day', () => {
  it('win-side golden string', () => {
    const result = narrate({
      beat: 'nemesis_last_day',
      data: { trailerHandle: 'Raven #3', leaderScore: 5, trailerScore: 4 },
    });
    expect(result.line).toBe('5–4. One day left. Raven #3 needs the sweep.');
  });

  it('loss-side golden string (bigger gap)', () => {
    const result = narrate({
      beat: 'nemesis_last_day',
      data: { trailerHandle: 'Hawk #9', leaderScore: 6, trailerScore: 1 },
    });
    expect(result.line).toBe('6–1. One day left. Hawk #9 needs the sweep.');
  });
});

describe('nemesis_verdict_win/loss/draw', () => {
  it('win golden string', () => {
    const result = narrate({
      beat: 'nemesis_verdict_win',
      data: { opponentHandle: 'Badger #1', myScore: 5, opponentScore: 2 },
    });
    expect(result.line).toBe('You read the week better than Badger #1, 5–2. Rematch is open.');
  });

  it('loss golden string — exact per §13.3 example', () => {
    const result = narrate({
      beat: 'nemesis_verdict_loss',
      data: { winnerHandle: 'Badger #1', winnerScore: 5, loserScore: 2 },
    });
    expect(result.line).toBe("It wasn't close. Badger #1 read the week better, 5–2. Rematch is open.");
  });

  it('draw golden string', () => {
    const result = narrate({
      beat: 'nemesis_verdict_draw',
      data: { opponentHandle: 'Crane #8', myScore: 3, opponentScore: 3 },
    });
    expect(result.line).toBe('Dead even with Crane #8, 3–3. Run it back.');
  });
});

describe('streak_milestone', () => {
  it('win-side (3-day) golden string', () => {
    const result = narrate({ beat: 'streak_milestone', data: { n: 3 } });
    expect(result.line).toBe('3 straight days. The printer keeps printing.');
  });

  it('a higher milestone (30-day) golden string', () => {
    const result = narrate({ beat: 'streak_milestone', data: { n: 30 } });
    expect(result.line).toBe('30 straight days. The printer keeps printing.');
  });
});

describe('streak_busted', () => {
  it('negative-beat exact golden string', () => {
    const result = narrate({ beat: 'streak_busted', data: { n: 12 } });
    expect(result.line).toBe('The 12-day streak ends here. Frame the receipt.');
  });

  it('a different streak length golden string', () => {
    const result = narrate({ beat: 'streak_busted', data: { n: 5 } });
    expect(result.line).toBe('The 5-day streak ends here. Frame the receipt.');
  });
});

describe('streak_freeze_used', () => {
  it('win-side (freeze saved the streak) golden string', () => {
    const result = narrate({ beat: 'streak_freeze_used', data: { freezesLeft: 1 } });
    expect(result.line).toBe('You missed yesterday. A freeze took the hit — 1 left.');
  });

  it('negative-adjacent: last freeze used golden string', () => {
    const result = narrate({ beat: 'streak_freeze_used', data: { freezesLeft: 0 } });
    expect(result.line).toBe('You missed yesterday. A freeze took the hit — 0 left.');
  });
});

describe('called_it', () => {
  it('win-side golden string', () => {
    const result = narrate({ beat: 'called_it', data: { impliedProbability: 0.15, handle: 'Ibis #6' } });
    expect(result.line).toBe('15% said no chance. Ibis #6 said otherwise.');
  });

  it('another longshot golden string', () => {
    const result = narrate({ beat: 'called_it', data: { impliedProbability: 0.05, handle: 'Wren #2' } });
    expect(result.line).toBe('5% said no chance. Wren #2 said otherwise.');
  });

  it('isCalledIt: boundary at exactly LONGSHOT_THRESHOLD (0.20) is called-it', () => {
    expect(isCalledIt(LONGSHOT_THRESHOLD)).toBe(true);
    expect(isCalledIt(0.2)).toBe(true);
  });

  it('isCalledIt: just above the boundary is not called-it', () => {
    expect(isCalledIt(0.2001)).toBe(false);
  });

  it('isCalledIt: well below the boundary is called-it', () => {
    expect(isCalledIt(0.01)).toBe(true);
  });
});

describe('duo_formed', () => {
  it('golden string', () => {
    const result = narrate({ beat: 'duo_formed', data: { partnerHandle: 'Finch #5' } });
    expect(result.line).toBe('You and Finch #5 just teamed up. First match starts soon.');
  });

  it('a different partner handle still renders correctly (negative/variation check)', () => {
    const result = narrate({ beat: 'duo_formed', data: { partnerHandle: 'Stoat #11' } });
    expect(result.line).toBe('You and Stoat #11 just teamed up. First match starts soon.');
  });
});

describe('duo_synergy_up', () => {
  it('win-side: joint hit rate beats both partners alone', () => {
    const result = narrate({
      beat: 'duo_synergy_up',
      data: { jointHitRate: 0.7, accuracyA: 0.55, accuracyB: 0.6 },
    });
    expect(result.line).toBe('You two hit 70% together — better than either of you alone.');
  });

  it('negative-side: joint hit rate is worse than at least one partner alone', () => {
    const result = narrate({
      beat: 'duo_synergy_up',
      data: { jointHitRate: 0.5, accuracyA: 0.55, accuracyB: 0.6 },
    });
    expect(result.line).toBe('You two hit 50% together — worse than either of you alone.');
  });
});

describe('duo_promoted', () => {
  it('win-side golden string', () => {
    const result = narrate({ beat: 'duo_promoted', data: { tier: 3 } });
    expect(result.line).toBe('Promoted to Tier 3. Onward.');
  });

  it('a different tier golden string', () => {
    const result = narrate({ beat: 'duo_promoted', data: { tier: 5 } });
    expect(result.line).toBe('Promoted to Tier 5. Onward.');
  });
});

describe('duo_relegated', () => {
  it('negative-beat golden string', () => {
    const result = narrate({ beat: 'duo_relegated', data: { tier: 2 } });
    expect(result.line).toBe('Relegated to Tier 2. Run it back next season.');
  });

  it('a different tier golden string', () => {
    const result = narrate({ beat: 'duo_relegated', data: { tier: 1 } });
    expect(result.line).toBe('Relegated to Tier 1. Run it back next season.');
  });
});

describe('claim_nudge_streak / claim_nudge_fingerprint — pinned verbatim strings (§10.6)', () => {
  it('claim_nudge_streak', () => {
    const result = narrate({ beat: 'claim_nudge_streak' });
    expect(result.line).toBe('Your ghost has a 3-day streak. Claim it before this device loses it.');
  });

  it('claim_nudge_fingerprint', () => {
    const result = narrate({ beat: 'claim_nudge_fingerprint' });
    expect(result.line).toBe('Your fingerprint is ready. Claim your record to get assigned your nemesis.');
  });
});

describe('deriveStyleClause', () => {
  it('returns the neutral clause when styles are close', () => {
    const clause = deriveStyleClause({ chalk: 0.1, contrarian: 0.1, timing: 0.1 }, { chalk: 0.15, contrarian: 0.05, timing: 0.12 });
    expect(clause).toBe('Even styles — this one comes down to the picks');
  });

  it('picks the axis with the largest delta deterministically', () => {
    const clause = deriveStyleClause({ chalk: 0, contrarian: 0, timing: 0.9 }, { chalk: 0, contrarian: 0, timing: -0.9 });
    expect(clause).toBe('They lock in early, before the line moves');
  });
});

describe('narrate — determinism (no LLM, no randomness)', () => {
  it('same input twice produces identical output', () => {
    const input = {
      beat: 'streak_milestone' as const,
      data: { n: 7 as const },
    };
    expect(narrate(input)).toEqual(narrate(input));
  });
});
