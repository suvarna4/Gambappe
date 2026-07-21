import { describe, expect, it } from 'vitest';
import type { ProfileId } from '@receipts/core';
import {
  deriveDayResults,
  deriveOutcome,
  deriveWeekDayResults,
  NEMESIS_SHARED_WEEK_DAYS,
  opponentOf,
  scoreMarginFromHistory,
  sideOutcome,
  verdictOutcomeFromHistory,
} from '../../lib/nemesis/verdict';
import type { PairingPublic, PairingScoreboardRow } from '../../lib/nemesis/types';

// Branded once here so every downstream use (as an override value or a call argument) is
// already contract-shaped — no per-call-site casting needed.
const A = { profile_id: 'a-1' as ProfileId, handle: 'A', slug: 'a' };
const B = { profile_id: 'b-1' as ProfileId, handle: 'B', slug: 'b' };

function pairing(
  overrides: Partial<PairingPublic> = {},
): Pick<PairingPublic, 'status' | 'winner_profile_id' | 'a' | 'b'> {
  return {
    status: 'completed',
    winner_profile_id: null,
    a: A,
    b: B,
    ...overrides,
  };
}

describe('deriveOutcome', () => {
  it('is "in_progress" while the pairing is active/scheduled', () => {
    expect(deriveOutcome(pairing({ status: 'active' }), A.profile_id)).toBe('in_progress');
    expect(deriveOutcome(pairing({ status: 'scheduled' }), A.profile_id)).toBe('in_progress');
  });

  it('is "cancelled" for a cancelled pairing regardless of viewer', () => {
    expect(deriveOutcome(pairing({ status: 'cancelled' }), A.profile_id)).toBe('cancelled');
    expect(deriveOutcome(pairing({ status: 'cancelled' }), null)).toBe('cancelled');
  });

  it('is "win" for the winning participant', () => {
    const p = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(deriveOutcome(p, A.profile_id)).toBe('win');
  });

  it('is "loss" for the losing participant', () => {
    const p = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(deriveOutcome(p, B.profile_id)).toBe('loss');
  });

  it('is "draw" for either participant when there is no winner', () => {
    const p = pairing({ status: 'completed', winner_profile_id: null });
    expect(deriveOutcome(p, A.profile_id)).toBe('draw');
    expect(deriveOutcome(p, B.profile_id)).toBe('draw');
  });

  it('is "unknown" for a spectator (non-participant, or no viewer) on a completed pairing', () => {
    const decisive = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(deriveOutcome(decisive, null)).toBe('unknown');
    expect(deriveOutcome(decisive, 'someone-else')).toBe('unknown');

    const drawn = pairing({ status: 'completed', winner_profile_id: null });
    expect(deriveOutcome(drawn, null)).toBe('unknown');
  });
});

describe('sideOutcome (objective, viewer-independent — used on the public /vs/[pairingId] page, INV-10)', () => {
  it('is "pending" while the pairing is active/scheduled, for either side', () => {
    expect(sideOutcome(pairing({ status: 'active' }), A.profile_id)).toBe('pending');
    expect(sideOutcome(pairing({ status: 'scheduled' }), B.profile_id)).toBe('pending');
  });

  it('is "cancelled" for either side of a cancelled pairing', () => {
    expect(sideOutcome(pairing({ status: 'cancelled' }), A.profile_id)).toBe('cancelled');
    expect(sideOutcome(pairing({ status: 'cancelled' }), B.profile_id)).toBe('cancelled');
  });

  it('is "win" for the winning side and "loss" for the other, with no viewer involved at all', () => {
    const p = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(sideOutcome(p, A.profile_id)).toBe('win');
    expect(sideOutcome(p, B.profile_id)).toBe('loss');
  });

  it('is "draw" for both sides when there is no winner', () => {
    const p = pairing({ status: 'completed', winner_profile_id: null });
    expect(sideOutcome(p, A.profile_id)).toBe('draw');
    expect(sideOutcome(p, B.profile_id)).toBe('draw');
  });
});

describe('opponentOf', () => {
  it('returns b when the viewer is a', () => {
    expect(opponentOf({ a: A, b: B }, A.profile_id)).toEqual(B);
  });

  it('returns a when the viewer is b', () => {
    expect(opponentOf({ a: A, b: B }, B.profile_id)).toEqual(A);
  });

  it('returns null for a spectator', () => {
    expect(opponentOf({ a: A, b: B }, null)).toBeNull();
    expect(opponentOf({ a: A, b: B }, 'someone-else')).toBeNull();
  });
});

describe('verdictOutcomeFromHistory (SW10-T2)', () => {
  it('maps win/loss/draw to VerdictCard outcomes', () => {
    expect(verdictOutcomeFromHistory('win')).toBe('won');
    expect(verdictOutcomeFromHistory('loss')).toBe('lost');
    expect(verdictOutcomeFromHistory('draw')).toBe('drew');
  });

  it('maps cancelled to null — VerdictOutcome has no cancelled member, no card renders', () => {
    expect(verdictOutcomeFromHistory('cancelled')).toBeNull();
  });
});

describe('scoreMarginFromHistory (SW10-T2)', () => {
  it('is the absolute difference between my_score and their_score', () => {
    expect(scoreMarginFromHistory({ my_score: 2, their_score: 5 })).toBe(3);
    expect(scoreMarginFromHistory({ my_score: 5, their_score: 2 })).toBe(3);
    expect(scoreMarginFromHistory({ my_score: 3, their_score: 3 })).toBe(0);
  });
});

describe('deriveDayResults (SW10-T2 — viewer-relative, re-pinned in fable round 4)', () => {
  function row(overrides: Partial<PairingScoreboardRow> = {}): PairingScoreboardRow {
    return {
      question_id: 'q-1' as PairingScoreboardRow['question_id'],
      slug: 'some-question',
      kind: 'daily',
      question_date: '2026-06-01',
      a: { side: 'yes', result: 'win' },
      b: { side: 'no', result: 'loss' },
      ...overrides,
    };
  }

  it('is win/loss for the VIEWER\'S OWN row result, not a head-to-head comparison', () => {
    // Viewer is A here and picked+won; B picked+lost — but the dot is about A's own result only.
    expect(deriveDayResults([row()], A.profile_id, { a: A, b: B })).toEqual(['win']);
    expect(deriveDayResults([row()], B.profile_id, { a: A, b: B })).toEqual(['loss']);
  });

  it('is a both-win day for both viewers when the scorer would award both — dots never disagree with independent scoring', () => {
    const bothWin = row({ a: { side: 'yes', result: 'win' }, b: { side: 'no', result: 'win' } });
    expect(deriveDayResults([bothWin], A.profile_id, { a: A, b: B })).toEqual(['win']);
    expect(deriveDayResults([bothWin], B.profile_id, { a: A, b: B })).toEqual(['win']);
  });

  it('is neutral for a void row', () => {
    const voided = row({ a: { side: 'yes', result: 'void' } });
    expect(deriveDayResults([voided], A.profile_id, { a: A, b: B })).toEqual(['neutral']);
  });

  it('is neutral when the viewer never picked that row (own side is null)', () => {
    const noPick = row({ a: null });
    expect(deriveDayResults([noPick], A.profile_id, { a: A, b: B })).toEqual(['neutral']);
  });

  it('is pending for an unsettled (masked or ungraded) row', () => {
    const masked = row({ a: null, b: null }); // §9.3 pre-lock masking nulls both sides
    // Viewer is B here; B's own row is masked-null too, so it's a no-pick-from-here-perspective
    // "neutral", not "pending" — pending is reserved for a picked-but-ungraded row.
    expect(deriveDayResults([masked], B.profile_id, { a: A, b: B })).toEqual(['neutral']);
    const ungraded = row({ a: { side: 'yes', result: 'pending' } });
    expect(deriveDayResults([ungraded], A.profile_id, { a: A, b: B })).toEqual(['pending']);
  });

  it('includes nemesis-bonus rows (null question_date) — the scorer counts them too', () => {
    const bonus = row({ kind: 'nemesis_bonus', question_date: null });
    expect(deriveDayResults([bonus], A.profile_id, { a: A, b: B })).toEqual(['win']);
  });

  it('preserves scoreboard row order across the whole week', () => {
    const rows = [
      row({ question_id: 'q-1' as PairingScoreboardRow['question_id'], a: { side: 'yes', result: 'win' } }),
      row({ question_id: 'q-2' as PairingScoreboardRow['question_id'], a: { side: 'no', result: 'loss' } }),
      row({ question_id: 'q-3' as PairingScoreboardRow['question_id'], a: null }),
    ];
    expect(deriveDayResults(rows, A.profile_id, { a: A, b: B })).toEqual(['win', 'loss', 'neutral']);
  });
});

describe('deriveWeekDayResults (design-diff audit — the "DAYS" strip, always NEMESIS_SHARED_WEEK_DAYS dots)', () => {
  const WEEK_START = '2026-06-01'; // a Monday

  function dailyRow(dayOffset: number, overrides: Partial<PairingScoreboardRow> = {}): PairingScoreboardRow {
    const d = new Date(`${WEEK_START}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return {
      question_id: `q-${dayOffset}` as PairingScoreboardRow['question_id'],
      slug: `q-${dayOffset}`,
      kind: 'daily',
      question_date: d.toISOString().slice(0, 10),
      a: { side: 'yes', result: 'win' },
      b: { side: 'no', result: 'loss' },
      ...overrides,
    };
  }

  it('always returns exactly NEMESIS_SHARED_WEEK_DAYS entries, even with a sparse or empty scoreboard', () => {
    expect(deriveWeekDayResults(WEEK_START, [], A.profile_id, { a: A, b: B })).toHaveLength(
      NEMESIS_SHARED_WEEK_DAYS,
    );
    expect(
      deriveWeekDayResults(WEEK_START, [dailyRow(0)], A.profile_id, { a: A, b: B }),
    ).toHaveLength(NEMESIS_SHARED_WEEK_DAYS);
  });

  it('fills a day with no matching daily row as neutral, rather than shrinking the strip', () => {
    // Only day 0 and day 2 exist — days 1, 3-6 are missing (a sparse dev DB, or a week that
    // hasn't reached that day yet).
    const rows = [dailyRow(0), dailyRow(2, { a: { side: 'yes', result: 'loss' }, b: { side: 'no', result: 'win' } })];
    const result = deriveWeekDayResults(WEEK_START, rows, A.profile_id, { a: A, b: B });
    expect(result).toEqual(['win', 'neutral', 'loss', 'neutral', 'neutral', 'neutral', 'neutral']);
  });

  it('excludes the nemesis_bonus row from the strip — a calendar-day strip, not a scored-row list', () => {
    const rows = [dailyRow(0), { ...dailyRow(1), kind: 'nemesis_bonus' as const, question_date: null }];
    const result = deriveWeekDayResults(WEEK_START, rows, A.profile_id, { a: A, b: B });
    expect(result).toHaveLength(NEMESIS_SHARED_WEEK_DAYS);
    // Day 1 (the would-be bonus slot) has no real daily row for that date, so it's neutral —
    // the bonus row never gets counted as if it were day 1's result.
    expect(result[1]).toBe('neutral');
  });

  it('is viewer-relative, same as deriveDayResults', () => {
    const rows = [dailyRow(0)];
    expect(deriveWeekDayResults(WEEK_START, rows, A.profile_id, { a: A, b: B })[0]).toBe('win');
    expect(deriveWeekDayResults(WEEK_START, rows, B.profile_id, { a: A, b: B })[0]).toBe('loss');
  });
});
