import { describe, expect, it } from 'vitest';
import { canPick, canUndo, needsAgeGate } from '@/lib/pick-eligibility';
import type { CachedPick } from '@/lib/pick-storage';

describe('needsAgeGate (DD-11/INV-9)', () => {
  it('requires the gate when not yet attested', () => {
    expect(needsAgeGate(false)).toBe(true);
  });
  it('skips the gate once attested', () => {
    expect(needsAgeGate(true)).toBe(false);
  });
});

describe('canPick (§10.3)', () => {
  it('only true while open', () => {
    expect(canPick('open')).toBe(true);
    for (const status of ['scheduled', 'locked', 'revealed', 'voided', 'draft']) {
      expect(canPick(status)).toBe(false);
    }
  });
});

describe('canUndo (§6.2 undo window)', () => {
  const lockAt = '2026-07-19T16:00:00Z';
  function pick(undoUntilIso: string): CachedPick {
    return { pickId: 'p1', side: 'yes', pickedAtIso: '2026-07-19T13:00:00Z', undoUntilIso };
  }

  it('true before the undo deadline and before lock', () => {
    const p = pick('2026-07-19T13:01:00Z');
    const now = new Date('2026-07-19T13:00:30Z').getTime();
    expect(canUndo(p, now, lockAt)).toBe(true);
  });

  it('false once the undo deadline passes', () => {
    const p = pick('2026-07-19T13:01:00Z');
    const now = new Date('2026-07-19T13:01:01Z').getTime();
    expect(canUndo(p, now, lockAt)).toBe(false);
  });

  it('false once lock_at passes, even if the 60s undo window would still be open', () => {
    const p = pick('2026-07-19T16:05:00Z'); // undo_until after lock (shouldn't happen, but be defensive)
    const now = new Date('2026-07-19T16:00:01Z').getTime();
    expect(canUndo(p, now, lockAt)).toBe(false);
  });
});
