/**
 * Unit tests for the §6.6 replay procedure (WS2-T3 AC: "streak replay after merge verified
 * against a hand-built multi-day fixture — some days with freezes, some voided"). Pure
 * function, no DB required. Also covers the WS3-T3 forward gap-decision helpers
 * (`decideGapFreezeConsumption`/`revealedDatesBetween`) used by `reveal:fire`/`streak:sweep`.
 */
import { describe, expect, it } from 'vitest';
import {
  replayStreak,
  revealedDatesBetween,
  decideGapFreezeConsumption,
  type ReplayDailyQuestion,
  type ReplayPick,
  type ReplayFreezeUse,
} from '../src/streak-replay.js';

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
      // SW9-T1: the dead run is remembered — 4 counted days, ended on its last COUNTED date.
      runs: [{ length: 4, startedOn: '2026-01-01', endedOn: '2026-01-06' }],
      currentRunStartedOn: null, // no live run after the break
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
      runs: [],
      currentRunStartedOn: null,
    });
  });

  it('a miss before any participation is a no-op (profile never started a streak)', () => {
    const dailyQuestions = [q('2026-04-01'), q('2026-04-02')];
    const result = replayStreak(dailyQuestions, [], []);
    expect(result.currentStreak).toBe(0);
    expect(result.lastCountedDate).toBeNull();
  });
});

describe('replayStreak runs/currentRunStartedOn (SW9-T1, obituary-handoff §3.1)', () => {
  it('records completed runs chronologically and anchors the live run to its first ANSWERED date', () => {
    const dailyQuestions = [
      q('2026-01-01'),
      q('2026-01-02'),
      q('2026-01-03'), // missed, uncovered -> run 1 dies (length 2)
      q('2026-01-04'),
      q('2026-01-05'), // missed, uncovered -> run 2 dies (length 1)
      q('2026-01-06'),
      q('2026-01-07'),
    ];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-01-01', result: 'win' },
      { questionId: 'q-2026-01-02', result: 'loss' },
      { questionId: 'q-2026-01-04', result: 'win' },
      { questionId: 'q-2026-01-06', result: 'win' },
      { questionId: 'q-2026-01-07', result: 'loss' },
    ];
    const result = replayStreak(dailyQuestions, picks, []);
    expect(result.runs).toEqual([
      { length: 2, startedOn: '2026-01-01', endedOn: '2026-01-02' },
      { length: 1, startedOn: '2026-01-04', endedOn: '2026-01-04' },
    ]);
    expect(result.currentRunStartedOn).toBe('2026-01-06');
    expect(result.currentStreak).toBe(2);
  });

  it('ZERO-GUARD (§3.1): N consecutive missed days record exactly ONE completed run, never zero-length entries', () => {
    // 2-day run, then FOUR consecutive uncovered missed days, then a comeback day. Without the
    // guard, each further missed day would re-trip `broken` with the counter already at 0
    // (lastCountedDate never advances on a break) and mint a zero-length garbage run.
    const dailyQuestions = [
      q('2026-02-01'),
      q('2026-02-02'),
      q('2026-02-03'),
      q('2026-02-04'),
      q('2026-02-05'),
      q('2026-02-06'),
      q('2026-02-07'),
    ];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-02-01', result: 'win' },
      { questionId: 'q-2026-02-02', result: 'win' },
      { questionId: 'q-2026-02-07', result: 'win' },
    ];
    const result = replayStreak(dailyQuestions, picks, []);
    expect(result.runs).toEqual([{ length: 2, startedOn: '2026-02-01', endedOn: '2026-02-02' }]);
    expect(result.runs.every((r) => r.length >= 1)).toBe(true);
    expect(result.currentRunStartedOn).toBe('2026-02-07');
  });

  it('misses before ANY participation never mint runs (first-ever-pick exclusion stays sound)', () => {
    const dailyQuestions = [q('2026-03-01'), q('2026-03-02'), q('2026-03-03')];
    const picks: ReplayPick[] = [{ questionId: 'q-2026-03-03', result: 'win' }];
    const result = replayStreak(dailyQuestions, picks, []);
    expect(result.runs).toEqual([]);
    expect(result.currentRunStartedOn).toBe('2026-03-03');
  });

  it('voided-tail run: endedOn is the contiguous voided date the profile never picked (§3.1)', () => {
    const dailyQuestions = [
      q('2026-04-01'),
      q('2026-04-02'),
      q('2026-04-03', 'voided'), // contiguous void advances lastCountedDate onto itself
      q('2026-04-04'), // missed, uncovered -> fatal
      q('2026-04-05'),
    ];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-04-01', result: 'win' },
      { questionId: 'q-2026-04-02', result: 'win' },
      { questionId: 'q-2026-04-05', result: 'win' },
    ];
    const result = replayStreak(dailyQuestions, picks, []);
    // endedOn is the last COUNTED date (the void), NOT the last answered date and NOT the miss.
    expect(result.runs).toEqual([{ length: 2, startedOn: '2026-04-01', endedOn: '2026-04-03' }]);
    expect(result.currentRunStartedOn).toBe('2026-04-05');
  });

  it('freeze-covered-tail run: endedOn is the covered missed date — the boundary date belongs to the run (§3.1)', () => {
    const dailyQuestions = [
      q('2026-05-01'),
      q('2026-05-02'),
      q('2026-05-03'), // missed, freeze-covered: advances lastCountedDate onto itself
      q('2026-05-04'), // missed, uncovered -> the run dies the day AFTER the freeze bridge
      q('2026-05-05'),
    ];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-05-01', result: 'win' },
      { questionId: 'q-2026-05-02', result: 'win' },
      { questionId: 'q-2026-05-05', result: 'win' },
    ];
    const result = replayStreak(dailyQuestions, picks, [{ coveredDate: '2026-05-03' }]);
    expect(result.runs).toEqual([{ length: 2, startedOn: '2026-05-01', endedOn: '2026-05-03' }]);
    // The half-open (startedOn, endedOn] freeze interval therefore contains 05-03 — consumers
    // counting freezes_survived include the tail freeze (asserted end-to-end in the payload
    // integration tests; pinned here as the interval's data source).
    expect(result.currentRunStartedOn).toBe('2026-05-05');
  });

  it('voided/covered days advance but never START a run (startedOn is the first answered date)', () => {
    const dailyQuestions = [
      q('2026-06-01'),
      q('2026-06-02', 'voided'),
      q('2026-06-03'),
    ];
    const picks: ReplayPick[] = [{ questionId: 'q-2026-06-03', result: 'win' }];
    // 06-01 missed before any participation (no-op), 06-02 voided (no lastCountedDate yet ->
    // no-op), 06-03 first answered day: the run starts there.
    const result = replayStreak(dailyQuestions, picks, []);
    expect(result.currentRunStartedOn).toBe('2026-06-03');
    expect(result.runs).toEqual([]);
  });

  it('a freeze-covered gap records NO run (no death happened)', () => {
    const dailyQuestions = [q('2026-07-01'), q('2026-07-02'), q('2026-07-03')];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-07-01', result: 'win' },
      { questionId: 'q-2026-07-03', result: 'win' },
    ];
    const result = replayStreak(dailyQuestions, picks, [{ coveredDate: '2026-07-02' }]);
    expect(result.runs).toEqual([]);
    expect(result.currentRunStartedOn).toBe('2026-07-01');
    expect(result.currentStreak).toBe(2);
  });
});

describe('revealedDatesBetween (§6.6 gap window)', () => {
  const dailyQuestions = [q('2026-05-01'), q('2026-05-02', 'voided'), q('2026-05-03'), q('2026-05-04')];

  it('null lower bound (no prior streak) → empty', () => {
    expect(revealedDatesBetween(dailyQuestions, null, '2026-05-04', true)).toEqual([]);
  });

  it('excludes voided dates and respects exclusive/inclusive end', () => {
    expect(revealedDatesBetween(dailyQuestions, '2026-05-01', '2026-05-04', false)).toEqual(['2026-05-03']);
    expect(revealedDatesBetween(dailyQuestions, '2026-05-01', '2026-05-04', true)).toEqual([
      '2026-05-03',
      '2026-05-04',
    ]);
  });
});

describe('decideGapFreezeConsumption (§6.6 forward gap rule — reveal:fire/streak:sweep)', () => {
  it('consumes freezes for each uncovered gap date, in order, until the bank is exhausted', () => {
    const dailyQuestions = [q('2026-06-01'), q('2026-06-02'), q('2026-06-03'), q('2026-06-04')];
    const result = decideGapFreezeConsumption({
      dailyQuestions,
      picks: [],
      existingFreezeUses: [],
      lastCountedDate: '2026-06-01',
      throughDate: '2026-06-04',
      includeThroughDate: false, // reveal:fire on day 06-04: gap is (06-01, 06-04) exclusive
      freezeBankBefore: 2,
    });
    expect(result.newFreezeUses).toEqual(['2026-06-02', '2026-06-03']);
    expect(result.freezeBankAfter).toBe(0);
    expect(result.broken).toBe(false);
  });

  it('breaks (stops walking) once the bank runs out, leaving later gap dates uncovered', () => {
    const dailyQuestions = [q('2026-07-01'), q('2026-07-02'), q('2026-07-03'), q('2026-07-04')];
    const result = decideGapFreezeConsumption({
      dailyQuestions,
      picks: [],
      existingFreezeUses: [],
      lastCountedDate: '2026-07-01',
      throughDate: '2026-07-04',
      includeThroughDate: false,
      freezeBankBefore: 1,
    });
    expect(result.newFreezeUses).toEqual(['2026-07-02']);
    expect(result.broken).toBe(true);
    expect(result.freezeBankAfter).toBe(0);
  });

  it('skips dates already recorded as freeze-covered (no double consumption)', () => {
    const dailyQuestions = [q('2026-08-01'), q('2026-08-02'), q('2026-08-03')];
    const result = decideGapFreezeConsumption({
      dailyQuestions,
      picks: [],
      existingFreezeUses: [{ coveredDate: '2026-08-02' }],
      lastCountedDate: '2026-08-01',
      throughDate: '2026-08-03',
      includeThroughDate: true, // streak:sweep through 08-03 (non-participant)
      freezeBankBefore: 1,
    });
    expect(result.newFreezeUses).toEqual(['2026-08-03']);
    expect(result.freezeBankAfter).toBe(0);
  });

  it('null last_counted_date (never started) is a no-op', () => {
    const result = decideGapFreezeConsumption({
      dailyQuestions: [q('2026-09-01')],
      picks: [],
      existingFreezeUses: [],
      lastCountedDate: null,
      throughDate: '2026-09-01',
      includeThroughDate: true,
      freezeBankBefore: 2,
    });
    expect(result).toEqual({ newFreezeUses: [], freezeBankAfter: 2, broken: false });
  });

  it('composes with replayStreak: persisting the decided uses reproduces the expected streak', () => {
    // 5-day run, freeze covers day 3 (a genuine miss), reveal processing day 5.
    const dailyQuestions = [
      q('2026-10-01'),
      q('2026-10-02'),
      q('2026-10-03'), // missed, freeze-covered by the decision below
      q('2026-10-04'),
      q('2026-10-05'),
    ];
    const picks: ReplayPick[] = [
      { questionId: 'q-2026-10-01', result: 'win' },
      { questionId: 'q-2026-10-02', result: 'win' },
      { questionId: 'q-2026-10-04', result: 'loss' },
      { questionId: 'q-2026-10-05', result: 'win' },
    ];
    const decision = decideGapFreezeConsumption({
      dailyQuestions,
      picks,
      existingFreezeUses: [],
      lastCountedDate: '2026-10-02',
      throughDate: '2026-10-05',
      includeThroughDate: false,
      freezeBankBefore: 1,
    });
    expect(decision.newFreezeUses).toEqual(['2026-10-03']);

    const freezeUses: ReplayFreezeUse[] = decision.newFreezeUses.map((coveredDate) => ({ coveredDate }));
    const result = replayStreak(dailyQuestions, picks, freezeUses);
    // 4 answered days (01, 02, 04, 05) count toward streak length; 03 is bridged, not counted.
    expect(result.currentStreak).toBe(4);
    expect(result.lastCountedDate).toBe('2026-10-05');
  });
});
