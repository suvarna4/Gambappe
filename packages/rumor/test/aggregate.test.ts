import { describe, expect, it } from 'vitest';

import {
  RAW_FLOOR_EPSILON,
  aggregateCrowdOdds,
  assembleSnapshot,
  defaultRumorSkill,
  entryWeight,
  snapshotEntries,
} from '../src/index.js';
import type { CrowdEntry, NbaTeam, PostSnapshot } from '../src/index.js';

const T0 = 1_530_000_000;
const skill = defaultRumorSkill('2026-07-24');
const entry = (over: Partial<CrowdEntry>): CrowdEntry => ({
  text: 'He is going to Miami',
  score: 100,
  subreddit: 'nba',
  createdUtc: T0,
  ...over,
});

describe('entryWeight', () => {
  it('grows with upvotes on a log scale', () => {
    const w10 = entryWeight(entry({ score: 10 }), 'MIA', skill, T0);
    const w1k = entryWeight(entry({ score: 1000 }), 'MIA', skill, T0);
    expect(w1k).toBeGreaterThan(w10);
    // log-scaled: 100× the votes buys ~3× the weight, not 100×.
    expect(w1k / w10).toBeLessThan(4);
    expect(entryWeight(entry({ score: 0 }), 'MIA', skill, T0)).toBe(0);
    expect(entryWeight(entry({ score: -5 }), 'MIA', skill, T0)).toBe(0);
  });

  it('discounts the team’s own fan sub, case-insensitively', () => {
    const neutral = entryWeight(entry({}), 'MIA', skill, T0);
    const homer = entryWeight(entry({ subreddit: 'Heat' }), 'MIA', skill, T0);
    expect(homer).toBeCloseTo(neutral * skill.homerDiscount, 10);
    // r/heat talking about Cleveland is NOT homerism.
    expect(entryWeight(entry({ subreddit: 'heat' }), 'CLE', skill, T0)).toBeCloseTo(neutral, 10);
  });

  it('halves per recency half-life and zeroes future evidence', () => {
    const now = entryWeight(entry({}), 'MIA', skill, T0);
    const halfLife = entryWeight(entry({}), 'MIA', skill, T0 + skill.recencyHalfLifeDays * 86_400);
    expect(halfLife).toBeCloseTo(now / 2, 10);
    expect(entryWeight(entry({ createdUtc: T0 + 1 }), 'MIA', skill, T0)).toBe(0);
  });
});

describe('aggregateCrowdOdds', () => {
  const candidates: NbaTeam[] = ['MIA', 'CLE', 'GSW'];

  it('is a probability distribution over candidates, deterministic', () => {
    const entries = [
      entry({ text: 'He has agreed with Miami, done deal', score: 500 }),
      entry({ text: 'Cleveland is the frontrunner', score: 200 }),
      entry({ text: 'the Warriors are pure leverage', score: 300 }),
    ];
    const a = aggregateCrowdOdds(entries, skill, candidates, T0);
    const b = aggregateCrowdOdds(entries, skill, candidates, T0);
    expect(a).toEqual(b);
    const sum = candidates.reduce((s, t) => s + a.odds[t], 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(a.odds.MIA).toBeGreaterThan(a.odds.CLE);
    // Warriors carry NEGATIVE raw mass (leverage) → floored to the epsilon share.
    expect(a.raw.GSW).toBeLessThan(0);
    expect(a.odds.GSW).toBeLessThan(a.odds.CLE);
    expect(a.entriesUsed).toBe(3);
  });

  it('ignores non-candidate mentions and future entries', () => {
    const entries = [
      entry({ text: 'Miami has agreed' }),
      entry({ text: 'the Knicks are signing him for sure', score: 9999 }),
      entry({ text: 'Cleveland confirmed', createdUtc: T0 + 10 }),
    ];
    const odds = aggregateCrowdOdds(entries, skill, candidates, T0);
    expect(odds.entriesUsed).toBe(1);
    expect(odds.raw.CLE).toBe(0);
    expect(odds.odds.MIA).toBeGreaterThan(odds.odds.CLE);
  });

  it('returns uniform odds on an uninformative corpus', () => {
    const odds = aggregateCrowdOdds([entry({ text: 'lol what a mess' })], skill, candidates, T0);
    for (const t of candidates) expect(odds.odds[t]).toBeCloseTo(1 / 3, 10);
    expect(odds.entriesUsed).toBe(0);
  });

  it('temperature sharpens below 1 and flattens above 1', () => {
    const entries = [
      entry({ text: 'Miami has agreed, done deal', score: 500 }),
      entry({ text: 'Cleveland though', score: 50 }),
    ];
    const base = aggregateCrowdOdds(entries, skill, candidates, T0);
    const sharp = aggregateCrowdOdds(entries, { ...skill, temperature: 0.5 }, candidates, T0);
    const flat = aggregateCrowdOdds(entries, { ...skill, temperature: 4 }, candidates, T0);
    expect(sharp.odds.MIA).toBeGreaterThan(base.odds.MIA);
    expect(flat.odds.MIA).toBeLessThan(base.odds.MIA);
    // Scale invariance: temperature never changes the ranking.
    expect(flat.odds.MIA).toBeGreaterThan(flat.odds.CLE);
  });

  it('floors all-negative candidates at the epsilon share of positive mass', () => {
    const entries = [
      entry({ text: 'Miami has agreed', score: 100 }),
      entry({ text: 'no chance for the Warriors, ruled out', score: 100 }),
    ];
    const odds = aggregateCrowdOdds(entries, skill, candidates, T0);
    expect(odds.raw.GSW).toBeLessThan(0);
    expect(odds.odds.GSW).toBeGreaterThan(0);
    const impliedFloorShare = RAW_FLOOR_EPSILON / (1 + 2 * RAW_FLOOR_EPSILON); // MIA + two floored teams
    expect(odds.odds.GSW).toBeCloseTo(impliedFloorShare, 5);
  });
});

describe('snapshotEntries', () => {
  it('emits the post text first, then comments, inheriting the post subreddit', () => {
    const snapshot: PostSnapshot = assembleSnapshot({
      source: 'arctic-shift',
      sagaId: 'lebron-2018',
      fetchedAt: '2026-07-24T00:00:00.000Z',
      post: {
        id: 'p1',
        subreddit: 'lakers',
        title: 'Welcome to the Lakers',
        selftext: 'discussion',
        score: 1000,
        createdUtc: T0,
        numComments: 1,
      },
      comments: [
        {
          id: 'c1',
          parentId: null,
          authorHash: 'abc123abc123',
          body: 'staying in Cleveland',
          score: 40,
          createdUtc: T0 + 60,
        },
      ],
    });
    const entries = snapshotEntries(snapshot);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.text).toContain('Welcome to the Lakers');
    expect(entries[0]!.score).toBe(1000);
    expect(entries[1]!.subreddit).toBe('lakers');
    expect(entries[1]!.score).toBe(40);
  });
});
