/**
 * SW9-T3 · `graveyardRipLengths` — the pure lengths-only projection behind
 * `ProfilePublic.graveyard.rip` (obituary-handoff §4): threshold (`OBITUARY_MIN_STREAK`),
 * newest-first ordering, `GRAVEYARD_RIP_CAP`, and the structural privacy pin (lengths are the
 * only field read — the output can't carry dates/slugs by construction). End-to-end derivation
 * against real Postgres seeds lives in `test/integration/profile-page.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { GRAVEYARD_RIP_CAP } from '@receipts/core';
import { OBITUARY_MIN_STREAK } from '@receipts/ui';
import type { CompletedStreakRun } from '@receipts/db';

import { graveyardRipLengths } from '@/lib/profile-page';

function run(length: number, startedOn: string, endedOn: string): CompletedStreakRun {
  return { length, startedOn, endedOn };
}

describe('graveyardRipLengths (SW9-T3)', () => {
  it('keeps only runs >= OBITUARY_MIN_STREAK, newest-first', () => {
    const runs = [
      run(11, '2026-01-01', '2026-01-11'),
      run(1, '2026-01-15', '2026-01-15'),
      run(6, '2026-02-01', '2026-02-06'),
      run(2, '2026-03-01', '2026-03-02'),
      run(3, '2026-04-01', '2026-04-03'),
    ];
    // Chronological in, newest-first out; the 1- and 2-day runs are not tombstone-worthy.
    expect(graveyardRipLengths(runs)).toEqual([3, 6, 11]);
    expect(OBITUARY_MIN_STREAK).toBe(3); // the mock's "RIP 3" chip is the smallest grave
  });

  it('caps at GRAVEYARD_RIP_CAP, dropping the OLDEST graves', () => {
    const runs = Array.from({ length: GRAVEYARD_RIP_CAP + 3 }, (_, i) =>
      run(3 + i, `2026-01-${String(i + 1).padStart(2, '0')}`, `2026-02-${String(i + 1).padStart(2, '0')}`),
    );
    const rip = graveyardRipLengths(runs);
    expect(rip).toHaveLength(GRAVEYARD_RIP_CAP);
    // Newest (longest, in this seed) survive the cap; the three oldest fall off the shelf.
    expect(rip[0]).toBe(3 + GRAVEYARD_RIP_CAP + 2);
    expect(rip.at(-1)).toBe(6);
  });

  it('empty in, empty out', () => {
    expect(graveyardRipLengths([])).toEqual([]);
  });
});
