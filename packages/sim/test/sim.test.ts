/**
 * WS26-T14 ACs (docs/plans/cpu-nemesis-wbs.md): the replay engine feeds policies only
 * price/category/time (leakage discipline), grades with §8.1 edge math verbatim, reports
 * deterministic metrics, and the baseline twins reproduce the production personas' behavior.
 */
import { describe, expect, it } from 'vitest';
import type { CpuPickInputs } from '@receipts/engine';
import {
  baselinePolicies,
  runBaselines,
  runSimulation,
  type PickPolicy,
  type SimMarketRow,
} from '../src/index.js';

function row(overrides: Partial<SimMarketRow> & { id: string }): SimMarketRow {
  return {
    category: 'sports',
    yesPrice: 0.62,
    timeToLockMs: 3600_000,
    outcome: 'yes',
    ...overrides,
  };
}

describe('runSimulation — grading and metrics', () => {
  const alwaysYes: PickPolicy = {
    name: 'always-yes',
    decide: () => ({ action: 'pick', side: 'yes' }),
  };

  it('grades picks with §8.1 edge math verbatim', () => {
    const rows = [
      row({ id: 'w', yesPrice: 0.62, outcome: 'yes' }), // win: edge = 1 - 0.62 = +0.38
      row({ id: 'l', yesPrice: 0.7, outcome: 'no' }), // loss: edge = 0 - 0.7 = -0.70
    ];
    const { report, records } = runSimulation(rows, alwaysYes);
    expect(records.map((r) => r.edge)).toEqual([1 - 0.62, -0.7]);
    expect(report.edgeSum).toBeCloseTo(0.38 - 0.7, 10);
    expect(report.wins).toBe(1);
    expect(report.winRate).toBeCloseTo(0.5, 10);
    expect(report.meanEntryProb).toBeCloseTo((0.62 + 0.7) / 2, 10);
    expect(report.brier).toBeCloseTo(((0.62 - 1) ** 2 + (0.7 - 0) ** 2) / 2, 10);
    expect(report.pickRate).toBe(1);
  });

  it('tracks streak texture and the believability expectation', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      row({ id, outcome: i < 3 ? 'yes' : 'no' }),
    );
    const { report } = runSimulation(rows, alwaysYes);
    expect(report.streaks.longestWin).toBe(3);
    expect(report.streaks.longestLoss).toBe(2);
    expect(report.streaks.expectedLongestWin).not.toBeNull();
  });

  it('is deterministic — identical inputs, identical reports', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', yesPrice: 0.3, outcome: 'no' })];
    expect(runSimulation(rows, alwaysYes)).toEqual(runSimulation(rows, alwaysYes));
  });
});

describe('leakage discipline', () => {
  it('a policy never sees the outcome at decide time, and observe fires only after', () => {
    const seen: Array<{ decideKeys: string[]; observedAfter: boolean }> = [];
    let observedForCurrentRow = false;
    const spy: PickPolicy = {
      name: 'spy',
      decide: (inputs: CpuPickInputs) => {
        observedForCurrentRow = false;
        seen.push({ decideKeys: Object.keys(inputs).sort(), observedAfter: false });
        return { action: 'pick', side: 'yes' };
      },
      observe: () => {
        observedForCurrentRow = true;
        seen[seen.length - 1]!.observedAfter = observedForCurrentRow;
      },
    };
    runSimulation([row({ id: 'a' }), row({ id: 'b' })], spy);
    for (const s of seen) {
      expect(s.decideKeys).toEqual(['category', 'persona', 'timeToLockMs', 'yesPrice']);
      expect(s.observedAfter).toBe(true); // outcome knowledge arrives strictly post-decision
    }
  });

  it('observe reports won=null for non-picks (skips still update nothing outcome-shaped)', () => {
    const observed: Array<boolean | null> = [];
    const skipper: PickPolicy = {
      name: 'skipper',
      decide: () => ({ action: 'skip' }),
      observe: (_row, _decision, won) => observed.push(won),
    };
    runSimulation([row({ id: 'a' })], skipper);
    expect(observed).toEqual([null]);
  });
});

describe('baseline twins reproduce the production personas', () => {
  it('chalk picks the favorite, fade the underdog, longshot skips mid-prices, clock waits far out', () => {
    const rows = [row({ id: 'fav', yesPrice: 0.62, timeToLockMs: 60 * 60_000 })];
    const byName = new Map(runBaselines(rows).map((r) => [r.policy, r]));
    expect(byName.get('baseline:chalk')!.picks).toBe(1);
    expect(byName.get('baseline:fade')!.picks).toBe(1);
    expect(byName.get('baseline:longshot')!.skips).toBe(1); // 0.62 is nobody's longshot
    expect(byName.get('baseline:clock')!.waits).toBe(1); // an hour out is too early

    const chalk = baselinePolicies().find((p) => p.name === 'baseline:chalk')!;
    const fade = baselinePolicies().find((p) => p.name === 'baseline:fade')!;
    const { records: chalkRecords } = runSimulation(rows, chalk);
    const { records: fadeRecords } = runSimulation(rows, fade);
    expect(chalkRecords[0]!.side).toBe('yes');
    expect(fadeRecords[0]!.side).toBe('no');
  });

  it('over a favorite-biased fixture, chalk out-edges fade (sanity of the harness itself)', () => {
    // 10 favorites at 0.70 of which 8 resolve yes — favorites slightly beat their price.
    const rows: SimMarketRow[] = Array.from({ length: 10 }, (_, i) =>
      row({ id: `m${i}`, yesPrice: 0.7, outcome: i < 8 ? 'yes' : 'no' }),
    );
    const byName = new Map(runBaselines(rows).map((r) => [r.policy, r]));
    const chalk = byName.get('baseline:chalk')!;
    const fade = byName.get('baseline:fade')!;
    expect(chalk.edgeSum).toBeGreaterThan(fade.edgeSum);
    expect(chalk.edgeSum).toBeCloseTo(8 * 0.3 + 2 * -0.7, 10);
    expect(fade.edgeSum).toBeCloseTo(2 * 0.7 + 8 * -0.3, 10);
  });
});
