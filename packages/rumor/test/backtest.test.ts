import { describe, expect, it } from 'vitest';

import {
  aggregateCrowdOdds,
  defaultRumorSkill,
  replayDays,
  replaySaga,
  scoreOdds,
  skillPolicy,
} from '../src/index.js';
import type { CrowdEntry, NbaTeam, RumorPolicy, SagaDef } from '../src/index.js';

const saga: SagaDef = {
  id: 'test-saga',
  player: 'Test Player',
  titleQuery: 'test',
  subreddits: ['nba'],
  from: '2018-06-25',
  to: '2018-06-28',
  resolvedAt: '2018-06-28',
  candidates: ['MIA', 'CLE', 'GSW'],
  outcome: 'CLE',
};

const day = (d: string): number => Date.parse(`${d}T12:00:00Z`) / 1000;
const entry = (text: string, createdUtc: number, score = 100): CrowdEntry => ({
  text,
  score,
  subreddit: 'nba',
  createdUtc,
});

describe('replayDays', () => {
  it('runs from `from` to the day BEFORE resolution', () => {
    expect(replayDays(saga)).toEqual(['2018-06-25', '2018-06-26', '2018-06-27']);
  });
});

describe('scoreOdds', () => {
  it('computes log-loss, brier, and rank by hand-checkable formula', () => {
    const odds = aggregateCrowdOdds(
      [entry('Miami has agreed, done deal', day('2018-06-25'))],
      defaultRumorSkill('t'),
      saga.candidates,
      day('2018-06-26'),
    );
    const score = scoreOdds(odds, 'CLE');
    expect(score.logLoss).toBeCloseTo(-Math.log(odds.odds.CLE), 10);
    const expectedBrier =
      (odds.odds.MIA - 0) ** 2 + (odds.odds.CLE - 1) ** 2 + (odds.odds.GSW - 0) ** 2;
    expect(score.brier).toBeCloseTo(expectedBrier, 10);
    expect(score.outcomeRank).toBe(2); // MIA leads, CLE and GSW share the floor
  });
});

describe('replaySaga — leakage discipline', () => {
  it('decide sees only evidence created up to each day’s end, never the outcome', () => {
    const seen: Array<{ asOf: number; texts: string[]; viewKeys: string[] }> = [];
    const spy: RumorPolicy = {
      name: 'spy',
      decide(view, entries, asOf) {
        seen.push({
          asOf,
          texts: entries.map((e) => e.text),
          viewKeys: Object.keys(view).sort(),
        });
        return aggregateCrowdOdds(entries, defaultRumorSkill('t'), view.candidates, asOf);
      },
    };
    const entries = [
      entry('day1: Miami has agreed', day('2018-06-25')),
      entry('day3: Cleveland confirmed, done deal', day('2018-06-27')),
      entry('day2: Warriors ruled out', day('2018-06-26')),
    ];
    replaySaga(saga, entries, spy);

    expect(seen).toHaveLength(3);
    expect(seen[0]!.texts).toEqual(['day1: Miami has agreed']);
    expect(seen[1]!.texts).toEqual(['day1: Miami has agreed', 'day2: Warriors ruled out']);
    expect(seen[2]!.texts).toEqual([
      'day1: Miami has agreed',
      'day2: Warriors ruled out',
      'day3: Cleveland confirmed, done deal',
    ]);
    // The SagaView never carries the outcome (structural, not conventional).
    for (const s of seen) {
      expect(s.viewKeys).toEqual(['candidates', 'from', 'id', 'player', 'to']);
    }
  });

  it('observe fires exactly once, after all days, with the outcome', () => {
    const calls: Array<{ atDayCount: number; outcome: NbaTeam }> = [];
    let daysDecided = 0;
    const policy: RumorPolicy = {
      name: 'observer',
      decide(view, entries, asOf) {
        daysDecided += 1;
        return aggregateCrowdOdds(entries, defaultRumorSkill('t'), view.candidates, asOf);
      },
      observe(_view, report, outcome) {
        calls.push({ atDayCount: report.days.length, outcome });
        expect(daysDecided).toBe(3); // every decision already made
      },
    };
    replaySaga(saga, [entry('Miami has agreed', day('2018-06-25'))], policy);
    expect(calls).toEqual([{ atDayCount: 3, outcome: 'CLE' }]);
  });

  it('report is deterministic and final equals the last day', () => {
    const entries = [
      entry('Miami has agreed', day('2018-06-25')),
      entry('Cleveland confirmed, welcome to Cleveland', day('2018-06-27'), 500),
    ];
    const a = replaySaga(saga, entries, skillPolicy(defaultRumorSkill('t')));
    const b = replaySaga(saga, entries, skillPolicy(defaultRumorSkill('t')));
    expect(a).toEqual(b);
    expect(a.final).toEqual(a.days.at(-1));
    expect(a.meanLogLoss).toBeCloseTo(
      a.days.reduce((s, d) => s + d.logLoss, 0) / a.days.length,
      12,
    );
    // Day 3's big Cleveland evidence flips the ranking by the final day.
    expect(a.days[0]!.outcomeRank).toBeGreaterThan(1);
    expect(a.final.outcomeRank).toBe(1);
  });

  it('throws on an empty replay window instead of returning a hollow report', () => {
    const broken = { ...saga, from: '2018-06-28' };
    expect(() => replaySaga(broken, [], skillPolicy(defaultRumorSkill('t')))).toThrow(
      /empty replay window/,
    );
  });
});
