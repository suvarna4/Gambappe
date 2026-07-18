/**
 * Handle collision-retry test (WS2-T1 AC): force collisions via a stubbed existence check /
 * deterministic RNG, verify retry-then-widen-to-5-digits behavior (§6.1.2).
 */
import { describe, expect, it } from 'vitest';
import { generateHandle } from '@/lib/handle-generator';

function sequenceRandom(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

describe('generateHandle (§6.1.2)', () => {
  it('returns a well-formed 4-digit handle + matching slug on the first try', async () => {
    const { handle, slug } = await generateHandle({
      handleExists: async () => false,
      random: sequenceRandom([0, 0]),
    });
    expect(handle).toMatch(/^[A-Za-z]+ #\d{4}$/);
    expect(slug).toBe(handle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  });

  it('retries on collision and eventually succeeds within the 4-digit budget', async () => {
    let calls = 0;
    const { handle } = await generateHandle({
      handleExists: async () => {
        calls += 1;
        return calls <= 5; // first 5 candidates "taken", 6th succeeds
      },
      random: Math.random,
    });
    expect(calls).toBe(6);
    expect(handle).toMatch(/^[A-Za-z]+ #\d{4}$/);
  });

  it('widens to 5 digits after 20 failed 4-digit tries', async () => {
    let calls = 0;
    const { handle } = await generateHandle({
      handleExists: async () => {
        calls += 1;
        return calls <= 20; // exhaust every 4-digit try, succeed on the first 5-digit try
      },
      random: Math.random,
    });
    expect(calls).toBe(21);
    expect(handle).toMatch(/^[A-Za-z]+ #\d{5}$/);
  });

  it('throws once both the 4- and 5-digit budgets are exhausted', async () => {
    await expect(
      generateHandle({ handleExists: async () => true, random: Math.random }),
    ).rejects.toThrow(/exhausted retries/);
  });
});
