import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LIVE_CAPTURE_MIN_AGE_S,
  LIVE_SAGA,
  aggregateCrowdOdds,
  defaultRumorSkill,
  devigMarket,
  divergence,
  flattenRedditComments,
  isCaptureReady,
  isNbaTeam,
  isOddsHistoryRow,
  parseGammaEvent,
  parseRedditPostListing,
  teamFromQuestion,
} from '../src/index.js';

const gammaFixture = (): unknown =>
  JSON.parse(readFileSync(new URL('./fixtures/polymarket-event.json', import.meta.url), 'utf8'));

describe('polymarket parsing', () => {
  it('maps full franchise names to codes', () => {
    expect(teamFromQuestion('Will LeBron James play for the Miami Heat in 2026-27?')).toBe('MIA');
    expect(teamFromQuestion('Will he play for the LA Clippers next year?')).toBe('LAC');
    expect(teamFromQuestion('Will LeBron retire instead?')).toBeNull();
  });

  it('parses the real 36-market fixture', () => {
    const prices = parseGammaEvent(gammaFixture());
    expect(prices.length).toBeGreaterThanOrEqual(30);
    for (const p of prices) {
      expect(isNbaTeam(p.team)).toBe(true);
      expect(p.yesPrice).toBeGreaterThanOrEqual(0);
      expect(p.yesPrice).toBeLessThanOrEqual(1);
    }
    // Real prices at fixture time: Miami led.
    const mia = prices.find((p) => p.team === 'MIA')!;
    expect(mia.yesPrice).toBeGreaterThan(0.3);
  });

  it('throws on malformed bodies', () => {
    expect(() => parseGammaEvent([])).toThrow(/non-empty/);
    expect(() => parseGammaEvent([{ markets: null }])).toThrow(/markets/);
  });

  it('de-vigs proportionally over exactly the candidate set', () => {
    const market = devigMarket(parseGammaEvent(gammaFixture()), LIVE_SAGA.candidates);
    const sum = LIVE_SAGA.candidates.reduce((s, t) => s + market.odds[t], 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(market.vig).toBeGreaterThan(-0.5);
    // Ordering survives normalization: MIA over CLE over LAL at fixture time.
    expect(market.odds.MIA).toBeGreaterThan(market.odds.CLE);
    expect(market.odds.CLE).toBeGreaterThan(market.odds.LAL);
  });
});

describe('reddit parsing', () => {
  const listing = {
    data: {
      children: [
        {
          kind: 't3',
          data: {
            id: 'abc',
            subreddit: 'nba',
            title: 'LeBron to Miami?',
            selftext: '',
            score: 1200,
            created_utc: 1_753_000_000,
            num_comments: 300,
          },
        },
        { kind: 't5', data: { id: 'not-a-post' } },
      ],
    },
  };

  it('parses t3 listings and skips other kinds', () => {
    const posts = parseRedditPostListing(listing);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.id).toBe('abc');
    expect(posts[0]!.score).toBe(1200);
  });

  it('flattens nested comment trees, hashes authors, skips more-stubs', () => {
    const tree = {
      data: {
        children: [
          {
            kind: 't1',
            data: {
              id: 'c1',
              parent_id: 't3_abc',
              author: 'realuser',
              body: 'Miami has agreed',
              score: 500,
              created_utc: 1_753_000_100,
              replies: {
                data: {
                  children: [
                    {
                      kind: 't1',
                      data: {
                        id: 'c2',
                        parent_id: 't1_c1',
                        author: '[deleted]',
                        body: 'no chance',
                        score: 40,
                        created_utc: 1_753_000_200,
                        replies: '',
                      },
                    },
                    { kind: 'more', data: { count: 12 } },
                  ],
                },
              },
            },
          },
        ],
      },
    };
    const comments = flattenRedditComments(tree);
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(comments[0]!.parentId).toBeNull();
    expect(comments[1]!.parentId).toBe('c1');
    expect(comments[0]!.authorHash).toMatch(/^[0-9a-f]{12}$/);
    expect(comments[1]!.authorHash).toBe('deleted');
    expect(JSON.stringify(comments)).not.toContain('realuser');
  });

  it('capture-once readiness respects the 2h owner decision', () => {
    const now = 1_753_010_000;
    expect(isCaptureReady({ createdUtc: now - LIVE_CAPTURE_MIN_AGE_S }, now)).toBe(true);
    expect(isCaptureReady({ createdUtc: now - LIVE_CAPTURE_MIN_AGE_S + 1 }, now)).toBe(false);
  });
});

describe('divergence', () => {
  it('computes delta, KL, and top-pick agreement', () => {
    const skill = defaultRumorSkill('t');
    const asOf = 1_753_000_000;
    const crowd = aggregateCrowdOdds(
      [{ text: 'Miami has agreed, done deal', score: 500, subreddit: 'nba', createdUtc: asOf }],
      skill,
      LIVE_SAGA.candidates,
      asOf,
    );
    const market = devigMarket(parseGammaEvent(gammaFixture()), LIVE_SAGA.candidates);
    const div = divergence(crowd, market, LIVE_SAGA.candidates);
    expect(div.topCrowd).toBe('MIA');
    expect(div.topMarket).toBe('MIA');
    expect(div.agree).toBe(true);
    expect(div.kl).toBeGreaterThan(0);
    const deltaSum = LIVE_SAGA.candidates.reduce((s, t) => s + div.delta[t], 0);
    expect(deltaSum).toBeCloseTo(0, 10); // both sides sum to 1
  });

  it('KL is zero against itself', () => {
    const market = devigMarket(parseGammaEvent(gammaFixture()), LIVE_SAGA.candidates);
    const selfCrowd = {
      asOf: 0,
      odds: market.odds,
      raw: market.odds,
      entriesUsed: 1,
      entriesTotal: 1,
    };
    expect(divergence(selfCrowd, market, LIVE_SAGA.candidates).kl).toBeCloseTo(0, 10);
  });
});

describe('odds history rows', () => {
  it('validates the row shape both with and without a crowd side', () => {
    const base = {
      date: '2026-07-24',
      asOf: 1_753_000_000,
      skillCutoff: '2021-01-13',
      market: { MIA: 0.5 },
      vig: 0.02,
      entriesUsed: 0,
      posts: 0,
    };
    expect(isOddsHistoryRow({ ...base, crowd: null, kl: null })).toBe(true);
    expect(isOddsHistoryRow({ ...base, crowd: { MIA: 0.6 }, kl: 0.04 })).toBe(true);
    expect(isOddsHistoryRow({ ...base, crowd: 'high', kl: null })).toBe(false);
    expect(isOddsHistoryRow(null)).toBe(false);
  });

  it('LIVE_SAGA candidates are valid and include the incumbent', () => {
    expect(LIVE_SAGA.candidates.every(isNbaTeam)).toBe(true);
    expect(LIVE_SAGA.candidates).toContain('LAL');
    expect(new Set(LIVE_SAGA.candidates).size).toBe(LIVE_SAGA.candidates.length);
  });
});
