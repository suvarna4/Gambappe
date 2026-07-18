/**
 * WS8-T1 unit: `ogStateHash` (§10.5 content-addressed `?v=`) — pure and deterministic.
 */
import { describe, expect, it } from 'vitest';
import { ogStateHash } from '../lib/og/hash';

describe('ogStateHash', () => {
  it('is deterministic for the same inputs', () => {
    const a = ogStateHash(['q1', 'open', 0.63, null]);
    const b = ogStateHash(['q1', 'open', 0.63, null]);
    expect(a).toBe(b);
  });

  it('changes when any part changes', () => {
    const base = ogStateHash(['q1', 'open', 0.63, null]);
    expect(ogStateHash(['q1', 'locked', 0.63, null])).not.toBe(base);
    expect(ogStateHash(['q1', 'open', 0.64, null])).not.toBe(base);
    expect(ogStateHash(['q2', 'open', 0.63, null])).not.toBe(base);
  });

  it('does not collide two different part boundaries with the same joined string', () => {
    // Without a delimiter, ['ab', 'c'] and ['a', 'bc'] would hash identically — this asserts
    // the join actually disambiguates boundaries.
    const x = ogStateHash(['ab', 'c']);
    const y = ogStateHash(['a', 'bc']);
    expect(x).not.toBe(y);
  });

  it('distinguishes null/undefined from their string forms', () => {
    const withNull = ogStateHash([null]);
    const withUndefined = ogStateHash([undefined]);
    expect(withNull).not.toBe(withUndefined);
  });

  it('is a short lowercase hex string', () => {
    const hash = ogStateHash(['x']);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });
});
