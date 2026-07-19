/**
 * WS7-T7 (duo UI) copy coverage: §8.10 "Tier display names (`Paper → Carbon → Ribbon → Ledger →
 * Archive`) live in `copy.ts`... 'Tier 1..5' is primary copy, the name secondary" and §8.9's
 * chemistry line formula ("only claims 'better than either alone' when
 * `joint > max(acc_a, acc_b)`"). Mirrors `copy.test.ts`'s "pinned copy" + "no money words"
 * pattern for this task's own additions.
 */
import { describe, expect, it } from 'vitest';
import { DUO_TIER_NAMES, duoCopy, duoTierLabel } from '@/lib/copy';

describe('§8.10 duo tier names', () => {
  it('matches the pinned order Paper → Carbon → Ribbon → Ledger → Archive', () => {
    expect(DUO_TIER_NAMES).toEqual(['Paper', 'Carbon', 'Ribbon', 'Ledger', 'Archive']);
  });

  it('duoTierLabel always leads with "Tier N" (primary copy) and the name secondary', () => {
    expect(duoTierLabel(1)).toBe('Tier 1 · Paper');
    expect(duoTierLabel(5)).toBe('Tier 5 · Archive');
  });

  it('falls back to a bare "Tier N" for an out-of-range tier rather than throwing', () => {
    expect(duoTierLabel(6)).toBe('Tier 6');
  });
});

describe('§8.9 duo chemistry line', () => {
  it('says "better" when synergy is positive (joint > expected)', () => {
    expect(duoCopy.chemistryLine(64, 0.05)).toBe(
      'You two hit 64% together — better than either of you alone',
    );
  });

  it('says "worse" when synergy is negative', () => {
    expect(duoCopy.chemistryLine(40, -0.05)).toBe(
      'You two hit 40% together — worse than either of you alone',
    );
  });

  it('falls back to "worse" on the exact-zero edge case (pinned copy has only two variants)', () => {
    expect(duoCopy.chemistryLine(50, 0)).toBe(
      'You two hit 50% together — worse than either of you alone',
    );
  });
});

describe('duo copy: no money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
  it('scans every string literal in duoCopy', () => {
    const strings = Object.values(duoCopy).filter((v): v is string => typeof v === 'string');
    const joined = strings.join(' ');
    expect(joined).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});
