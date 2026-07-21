/**
 * WS16-T1 — journeys-plan core contracts (docs/journeys-plan.md §4/§5).
 * Pins the additive enum/flag/schema surface every WS16–WS24 task builds on: the `'topic'`
 * question kind, the three journeys flags (default off), and the new stack / topic-follow /
 * call-out / same-side schemas. Additive-only: no existing schema's parse behavior changes.
 */
import { describe, expect, it } from 'vitest';

import { CALLOUT_STATUS, QUESTION_KIND } from '../src/enums.js';
import { FLAG_DEFAULTS, FLAG_NAMES } from '../src/flags.js';
import {
  acceptCalloutResponseSchema,
  calloutCreateResponseSchema,
  calloutPreviewSchema,
  calloutSchema,
  createCalloutBodySchema,
  getStackResponseSchema,
  nemesisFlipSchema,
  sameSideSchema,
  setTopicFollowRequestSchema,
  stackFeedSchema,
  topicFollowSchema,
} from '../src/schemas/index.js';

const UUID = '018f0000-0000-7000-8000-000000000001';
const UUID2 = '018f0000-0000-7000-8000-000000000002';

const profileRef = { profile_id: UUID, handle: 'nemo', slug: 'nemo' };

const questionPublic = {
  id: UUID,
  slug: 'topic-fed-hike',
  kind: 'topic' as const,
  status: 'open' as const,
  question_date: null,
  headline: 'Will the Fed hike in March?',
  blurb: null,
  yes_label: 'Hike',
  no_label: 'Hold',
  open_at: '2026-07-21T00:00:00.000Z',
  lock_at: '2026-08-21T00:00:00.000Z',
  reveal_at: '2026-08-21T00:00:00.000Z',
  yes_price: 0.42,
  yes_price_updated_at: '2026-07-21T00:00:00.000Z',
  crowd: null,
  outcome: null,
  revealed_at: null,
  void_reason: null,
  is_volatile: false,
  venue: 'kalshi' as const,
  venue_url: 'https://kalshi.com/markets/fed',
};

describe('QUESTION_KIND += topic', () => {
  it('includes topic without dropping existing kinds', () => {
    expect(QUESTION_KIND).toContain('topic');
    expect(QUESTION_KIND).toContain('daily');
    expect(QUESTION_KIND).toContain('nemesis_bonus');
    expect(QUESTION_KIND).toContain('duo_bonus');
  });
});

describe('journeys flags', () => {
  it('adds topic_markets / callouts / departures_board, all default off', () => {
    for (const name of ['topic_markets', 'callouts', 'departures_board'] as const) {
      expect(FLAG_NAMES).toContain(name);
      expect(FLAG_DEFAULTS[name]).toBe(false);
    }
  });
});

describe('stackFeedSchema', () => {
  it('accepts a headliner + topic cards, incl. optional rival_sealed', () => {
    const parsed = getStackResponseSchema.parse({
      headliner: { ...questionPublic, kind: 'daily', rival_sealed: true },
      topics: [questionPublic, { ...questionPublic, rival_sealed: null }],
    });
    expect(parsed.topics).toHaveLength(2);
  });

  it('accepts a null headliner and empty topics (flag-off shape)', () => {
    expect(stackFeedSchema.parse({ headliner: null, topics: [] }).topics).toEqual([]);
  });

  it('rejects a non-array topics field', () => {
    expect(stackFeedSchema.safeParse({ headliner: null, topics: {} }).success).toBe(false);
  });
});

describe('topic follow schemas', () => {
  it('validates a follow state and route params', () => {
    expect(topicFollowSchema.parse({ category: 'economics', following: true }).following).toBe(true);
    expect(
      setTopicFollowRequestSchema.parse({ params: { category: 'sports' } }).params.category,
    ).toBe('sports');
  });

  it('rejects an unknown category', () => {
    expect(topicFollowSchema.safeParse({ category: 'weather', following: true }).success).toBe(false);
  });
});

describe('callout schemas', () => {
  const callout = {
    id: UUID,
    status: 'pending' as const,
    challenger: profileRef,
    opponent: null,
    expires_at: '2026-07-22T00:00:00.000Z',
    created_at: '2026-07-21T00:00:00.000Z',
    pairing_id: null,
  };

  it('CALLOUT_STATUS pins the four lifecycle states', () => {
    expect([...CALLOUT_STATUS]).toEqual(['pending', 'accepted', 'declined', 'expired']);
  });

  it('validates a pending callout and its create response with a share URL', () => {
    expect(calloutSchema.parse(callout).opponent).toBeNull();
    const created = calloutCreateResponseSchema.parse({
      callout,
      share_url: 'https://gambappe.example/rivals?callout=abc',
    });
    expect(created.share_url).toContain('callout=');
  });

  it('validates an accepted callout carrying opponent + pairing_id', () => {
    const accepted = acceptCalloutResponseSchema.parse({
      callout: { ...callout, status: 'accepted', opponent: { ...profileRef, profile_id: UUID2, handle: 'rival', slug: 'rival' }, pairing_id: UUID2 },
    });
    expect(accepted.callout.pairing_id).toBe(UUID2);
  });

  it('preview is spectator-safe (no opponent field) and rejects a non-URL share link', () => {
    expect('opponent' in calloutPreviewSchema.parse({ status: 'pending', challenger: profileRef, expires_at: callout.expires_at })).toBe(false);
    expect(
      calloutCreateResponseSchema.safeParse({ callout, share_url: 'not a url' }).success,
    ).toBe(false);
  });

  it('create body rejects unknown keys (strict)', () => {
    expect(createCalloutBodySchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(createCalloutBodySchema.parse({}).target_profile_id).toBeUndefined();
  });
});

describe('sameSideSchema + nemesis reveal integration', () => {
  it('validates a same-side day result and rejects out-of-range prices', () => {
    expect(sameSideSchema.parse({ your_price: 42, their_price: 55, winner: 'you' }).winner).toBe('you');
    expect(sameSideSchema.safeParse({ your_price: 101, their_price: 10, winner: 'draw' }).success).toBe(false);
    expect(sameSideSchema.safeParse({ your_price: 1, their_price: 2, winner: 'nobody' }).success).toBe(false);
  });

  it('nemesisFlipSchema accepts an optional same_side and still parses without it', () => {
    const base = {
      opponent_handle: 'rival',
      opponent_side: 'yes' as const,
      opponent_side_label: 'Hike',
      opponent_entry_cents: 55,
      narration: null,
      you_wins: 1,
      opponent_wins: 0,
      week_label: 'Week of Jul 20 · Day 2',
    };
    expect(nemesisFlipSchema.parse(base).same_side).toBeUndefined();
    expect(
      nemesisFlipSchema.parse({ ...base, same_side: { your_price: 40, their_price: 60, winner: 'you' } }).same_side
        ?.winner,
    ).toBe('you');
  });
});
