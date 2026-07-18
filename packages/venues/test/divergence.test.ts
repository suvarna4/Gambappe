/**
 * WS1-T7 AC (§7.7): spread shown only when both prices are < 15 min old; stale-either-side →
 * no spread.
 */
import { describe, expect, it } from 'vitest';
import { computeDivergence, type VenuePriceReading } from '../src/divergence.js';

const AT = new Date('2026-07-19T20:00:00Z');

function reading(venue: 'kalshi' | 'polymarket', yesPrice: number, minutesAgo: number): VenuePriceReading {
  return { venue, yesPrice, ts: new Date(AT.getTime() - minutesAgo * 60_000) };
}

describe('computeDivergence', () => {
  it('computes the spread when both readings are fresh', () => {
    const a = reading('kalshi', 0.62, 2);
    const b = reading('polymarket', 0.58, 5);
    const result = computeDivergence(a, b, AT);
    expect(result).toEqual({
      venueA: 'kalshi',
      priceA: 0.62,
      venueB: 'polymarket',
      priceB: 0.58,
      spread: expect.closeTo(0.04, 5),
    });
  });

  it('returns null when the first reading is stale (> 15 min)', () => {
    const a = reading('kalshi', 0.62, 16);
    const b = reading('polymarket', 0.58, 1);
    expect(computeDivergence(a, b, AT)).toBeNull();
  });

  it('returns null when the second reading is stale (>= 15 min)', () => {
    const a = reading('kalshi', 0.62, 1);
    const b = reading('polymarket', 0.58, 20);
    expect(computeDivergence(a, b, AT)).toBeNull();
  });

  it('returns null when both readings are stale', () => {
    const a = reading('kalshi', 0.62, 30);
    const b = reading('polymarket', 0.58, 45);
    expect(computeDivergence(a, b, AT)).toBeNull();
  });

  it('treats exactly-15-minutes-old as fresh (boundary is inclusive)', () => {
    const a = reading('kalshi', 0.62, 15);
    const b = reading('polymarket', 0.58, 0);
    const result = computeDivergence(a, b, AT);
    expect(result).not.toBeNull();
  });

  it('treats a hair past 15 minutes as stale', () => {
    const a = reading('kalshi', 0.62, 15.01);
    const b = reading('polymarket', 0.58, 0);
    expect(computeDivergence(a, b, AT)).toBeNull();
  });

  it('defaults `at` to the current clock (now())', async () => {
    const { setTestClock } = await import('@receipts/core');
    setTestClock(AT);
    const a = reading('kalshi', 0.5, 1);
    const b = reading('polymarket', 0.55, 1);
    expect(computeDivergence(a, b)).not.toBeNull();
    setTestClock(null);
  });
});
