/**
 * Unit tests for the §6.6 replay procedure (WS2-T3 AC: "streak replay after merge verified
 * against a hand-built multi-day fixture — some days with freezes, some voided"). Pure
 * function, no DB required.
 */
import { describe, expect, it } from 'vitest';
import { replayStreak, type ReplayDailyQuestion, type ReplayPick, type ReplayFreezeUse } from '../src/streak-replay.js';

function q(date: string, status: 'revealed' | 'voided' = 'revealed'): ReplayDailyQuestion {
  return { id: `q-${date}`, questionDate: date, status };
}

describe('replayStreak (§6.6)', () => {
  it('replays a 7-day fixture: 3 wins, a void, a freeze-covered miss, a win, a broken miss', () => {
    const dailyQuestions: ReplayDailyQuestion[] = [
      q('2026-01-01'),
      q('2026-01-02'),
      q('2026-01-03'),
      q('2026-01-04', 'voided'),
      q('2026-01-05'), // missed, freeze-covered
      q('2026-01-06'),
      q('2026-01-07'), // missed, NOT freeze-covered — breaks the streak
    ];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-01-01', result: 'win' },
      { questionId: 'q-2026-01-02', result: 'win' },
      { questionId: 'q-2026-01-03', result: 'win' },
      { questionId: 'q-2026-01-06', result: 'win' },
    ];
    const freezeUses: ReplayFreezeUse[] = [{ coveredDate: '2026-01-05' }];

    const result = replayStreak(dailyQuestions, picks, freezeUses);

    expect(result).toEqual({
      currentStreak: 0, // broken by the uncovered miss on 01-07
      bestStreak: 4, // peaked after the 01-06 win (3 + freeze-covered gap + 1)
      lastCountedDate: '2026-01-06', // last successful advance; 01-07's break doesn't move it
      currentWinStreak: 4, // win streak is unaffected by non-participation
      bestWinStreak: 4,
    });
  });

  it('a fully unbroken run with no misses', () => {
    const dailyQuestions = [q('2026-02-01'), q('2026-02-02'), q('2026-02-03')];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-02-01', result: 'win' },
      { questionId: 'q-2026-02-02', result: 'loss' },
      { questionId: 'q-2026-02-03', result: 'win' },
    ];
    const result = replayStreak(dailyQuestions, picks, []);
    expect(result.currentStreak).toBe(3);
    expect(result.bestStreak).toBe(3);
    expect(result.lastCountedDate).toBe('2026-02-03');
    // loss on 02-02 resets win streak to 0, then win on 02-03 brings it to 1.
    expect(result.currentWinStreak).toBe(1);
    expect(result.bestWinStreak).toBe(1);
  });

  it('void days never break or grow the streak', () => {
    const dailyQuestions = [q('2026-03-01'), q('2026-03-02', 'voided'), q('2026-03-03')];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-03-01', result: 'win' },
      { questionId: 'q-2026-03-03', result: 'win' },
    ];
    const result = replayStreak(dailyQuestions, picks, []);
    expect(result.currentStreak).toBe(2);
    expect(result.lastCountedDate).toBe('2026-03-03');
  });

  it('a profile with no history at all replays to zero/null', () => {
    const result = replayStreak([], [], []);
    expect(result).toEqual({
      currentStreak: 0,
      bestStreak: 0,
      lastCountedDate: null,
      currentWinStreak: 0,
      bestWinStreak: 0,
    });
  });

  it('a miss before any participation is a no-op (profile never started a streak)', () => {
    const dailyQuestions = [q('2026-04-01'), q('2026-04-02')];
    const result = replayStreak(dailyQuestions, [], []);
    expect(result.currentStreak).toBe(0);
    expect(result.lastCountedDate).toBeNull();
  });
});
