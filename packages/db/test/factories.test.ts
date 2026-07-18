/**
 * WS0-T3 AC (pure part): factories build a graded question with 3 picks, internally
 * consistent with §5.3/§8.1 semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGradedQuestionScenario,
  buildPick,
  buildProfile,
  buildQuestion,
  computeEdge,
} from '../src/testing/factories.js';

describe('computeEdge (§8.1)', () => {
  it('edge = (win?1:0) − implied entry prob of chosen side', () => {
    expect(computeEdge('yes', 0.6, true)).toBeCloseTo(0.4, 10);
    expect(computeEdge('yes', 0.6, false)).toBeCloseTo(-0.6, 10);
    expect(computeEdge('no', 0.7, true)).toBeCloseTo(0.7, 10);
    expect(computeEdge('no', 0.7, false)).toBeCloseTo(-0.3, 10);
  });
});

describe('buildGradedQuestionScenario', () => {
  it('produces a revealed daily with 3 graded picks', () => {
    const s = buildGradedQuestionScenario();
    expect(s.question.status).toBe('revealed');
    expect(s.question.outcome).toBe('yes');
    expect(s.picks).toHaveLength(3);
    expect(s.profiles).toHaveLength(3);

    // Grading consistency: winners picked the outcome side, losers didn't.
    for (const pick of s.picks) {
      expect(pick.result).toBe(pick.side === s.question.outcome ? 'win' : 'loss');
      const won = pick.result === 'win';
      expect(pick.edge).toBeCloseTo(
        computeEdge(pick.side as 'yes' | 'no', pick.yesPriceAtEntry as number, won),
        10,
      );
      expect(pick.gradedAt).toBeInstanceOf(Date);
    }

    // Counter/lock-snapshot consistency (§6.2 lock job semantics).
    const yes = s.picks.filter((p) => p.side === 'yes').length;
    const no = s.picks.filter((p) => p.side === 'no').length;
    expect(s.question.yesCount).toBe(yes);
    expect(s.question.noCount).toBe(no);
    expect(s.question.crowdYesAtLock).toBe(yes);
    expect(s.question.crowdNoAtLock).toBe(no);

    // Every pick belongs to the question and a distinct profile.
    const profileIds = new Set(s.picks.map((p) => p.profileId));
    expect(profileIds.size).toBe(3);
    for (const pick of s.picks) expect(pick.questionId).toBe(s.question.id);
  });

  it('lock precedes reveal precedes nothing weird (§5.3 window)', () => {
    const s = buildGradedQuestionScenario();
    const q = s.question;
    expect((q.openAt as Date).getTime()).toBeLessThan((q.lockAt as Date).getTime());
    expect((q.lockAt as Date).getTime()).toBeLessThan((q.revealAt as Date).getTime());
  });
});

describe('builders', () => {
  it('profiles get unique handles and derived slugs', () => {
    const a = buildProfile();
    const b = buildProfile();
    expect(a.handle).not.toBe(b.handle);
    expect(a.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('overrides win', () => {
    const q = buildQuestion('m-id', { kind: 'nemesis_bonus', questionDate: null });
    expect(q.kind).toBe('nemesis_bonus');
    const p = buildPick('q', 'p', { side: 'no', confidence: 80 });
    expect(p.side).toBe('no');
    expect(p.confidence).toBe(80);
  });
});
