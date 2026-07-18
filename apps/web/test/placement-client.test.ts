/**
 * Unit tests for the pure helpers in `apps/web/lib/placement-client.ts` (WS7-T10). The
 * network-fetching half (`fetchPlacementItems`/`submitPlacementAnswer`) and the full 5-tap
 * flow are covered end-to-end by `apps/web/e2e/placement.spec.ts` instead — these are the
 * cheap, DOM-free pieces (§17.1 unit-test scope).
 */
import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  crowdCountsFromPct,
  outcomeLabel,
  tallyResults,
  type PlacementAnswerResult,
} from '@/lib/placement-client';

describe('outcomeLabel', () => {
  const item = { yes_label: 'Favorite won', no_label: 'Underdog won' };

  it('returns yes_label for side yes', () => {
    expect(outcomeLabel(item, 'yes')).toBe('Favorite won');
  });

  it('returns no_label for side no', () => {
    expect(outcomeLabel(item, 'no')).toBe('Underdog won');
  });
});

describe('crowdCountsFromPct', () => {
  it('splits a mid-range pct into a yes/no count pair summing to 100', () => {
    expect(crowdCountsFromPct(65)).toEqual({ yesCount: 65, noCount: 35 });
  });

  it('clamps below 0 and above 100 defensively', () => {
    expect(crowdCountsFromPct(-5)).toEqual({ yesCount: 0, noCount: 100 });
    expect(crowdCountsFromPct(150)).toEqual({ yesCount: 100, noCount: 0 });
  });
});

describe('categoryLabel', () => {
  it('title-cases the lowercase market_category enum value', () => {
    expect(categoryLabel('sports')).toBe('Sports');
    expect(categoryLabel('economics')).toBe('Economics');
  });
});

describe('tallyResults', () => {
  function result(correct: boolean): PlacementAnswerResult {
    return {
      item_id: 'x',
      side: 'yes',
      outcome: correct ? 'yes' : 'no',
      correct,
      historical_yes_price: 0.5,
      historical_crowd_yes_pct: 50,
      resolved_on: '2024-01-01',
    };
  }

  it('counts correct answers out of the total', () => {
    expect(tallyResults([result(true), result(false), result(true)])).toEqual({
      correct: 2,
      total: 3,
    });
  });

  it('handles an empty result set', () => {
    expect(tallyResults([])).toEqual({ correct: 0, total: 0 });
  });
});
