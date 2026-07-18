import { describe, expect, it } from 'vitest';
import { refillRateFor, retryAfterSeconds } from '../lib/rate-limit';

describe('refillRateFor', () => {
  it('is capacity divided by the window', () => {
    expect(refillRateFor(120, 3600)).toBeCloseTo(120 / 3600);
    expect(refillRateFor(10, 86400)).toBeCloseTo(10 / 86400);
  });
});

describe('retryAfterSeconds', () => {
  it('is 0 when at least one token remains', () => {
    expect(retryAfterSeconds(1, 1)).toBe(0);
    expect(retryAfterSeconds(5.5, 0.1)).toBe(0);
  });

  it('rounds up to the next whole second when out of tokens', () => {
    // Needs 0.5 more tokens at a refill rate of 1/10s → 5s.
    expect(retryAfterSeconds(0.5, 0.1)).toBe(5);
  });

  it('is never less than 1 second when tokens are exhausted', () => {
    expect(retryAfterSeconds(0.999, 1000)).toBe(1);
  });
});
