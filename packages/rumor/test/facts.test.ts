import { describe, expect, it } from 'vitest';

import { applyFactLedger, isFactLedger } from '../src/index.js';
import type { CrowdOdds, FactLedger, NbaTeam } from '../src/index.js';

const candidates: NbaTeam[] = ['MIA', 'CLE', 'LAL'];

const odds = (values: Record<string, number>): CrowdOdds => ({
  asOf: 1_753_000_000,
  odds: values as Record<NbaTeam, number>,
  raw: values as Record<NbaTeam, number>,
  entriesUsed: 10,
  entriesTotal: 20,
});

const fact = (team: NbaTeam, capAt: number) => ({
  team,
  capAt,
  reason: 'officially announced',
  source: 'https://example.com/citation',
  addedAt: '2026-07-24',
});

const ledger = (facts: ReturnType<typeof fact>[]): FactLedger => ({ version: 1, facts });

describe('isFactLedger', () => {
  it('accepts a valid ledger and a JSON round-trip', () => {
    const l = ledger([fact('LAL', 0.005)]);
    expect(isFactLedger(l)).toBe(true);
    expect(isFactLedger(JSON.parse(JSON.stringify(l)))).toBe(true);
    expect(isFactLedger({ version: 1, facts: [] })).toBe(true);
  });

  it('rejects structural corruption', () => {
    expect(isFactLedger(null)).toBe(false);
    expect(isFactLedger({ version: 2, facts: [] })).toBe(false);
    expect(isFactLedger(ledger([fact('XXX' as NbaTeam, 0.1)]))).toBe(false);
    expect(isFactLedger(ledger([fact('LAL', 0)]))).toBe(false);
    expect(isFactLedger(ledger([fact('LAL', 1)]))).toBe(false);
    expect(isFactLedger(ledger([{ ...fact('LAL', 0.1), source: '' }]))).toBe(false);
    expect(isFactLedger(ledger([{ ...fact('LAL', 0.1), reason: '' }]))).toBe(false);
  });
});

describe('applyFactLedger', () => {
  it('caps a bound team and redistributes proportionally to uncapped teams', () => {
    const input = odds({ MIA: 0.5, CLE: 0.4, LAL: 0.1 });
    const { odds: out, applied } = applyFactLedger(input, ledger([fact('LAL', 0.005)]), candidates);
    expect(applied).toHaveLength(1);
    expect(out.odds.LAL).toBeCloseTo(0.005, 12);
    const sum = candidates.reduce((s, t) => s + out.odds[t], 0);
    expect(sum).toBeCloseTo(1, 12);
    // Uncapped teams keep their ratio (0.5 : 0.4).
    expect(out.odds.MIA / out.odds.CLE).toBeCloseTo(0.5 / 0.4, 12);
    expect(out.odds.MIA).toBeGreaterThan(0.5); // received its share of the excess
    // Audit trail intact: raw and counts untouched, input not mutated.
    expect(out.raw).toEqual(input.raw);
    expect(out.entriesUsed).toBe(10);
    expect(input.odds.LAL).toBe(0.1);
  });

  it('is a no-op when the cap does not bind', () => {
    const input = odds({ MIA: 0.6, CLE: 0.397, LAL: 0.003 });
    const { odds: out, applied } = applyFactLedger(input, ledger([fact('LAL', 0.005)]), candidates);
    expect(applied).toHaveLength(0);
    expect(out.odds).toEqual(input.odds);
  });

  it('takes the minimum cap when multiple facts target one team', () => {
    const input = odds({ MIA: 0.5, CLE: 0.4, LAL: 0.1 });
    const l = ledger([fact('LAL', 0.05), fact('LAL', 0.01)]);
    const { odds: out, applied } = applyFactLedger(input, l, candidates);
    expect(out.odds.LAL).toBeCloseTo(0.01, 12);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.capAt).toBe(0.01);
  });

  it('ignores facts for non-candidate teams and is deterministic', () => {
    const input = odds({ MIA: 0.5, CLE: 0.4, LAL: 0.1 });
    const l = ledger([fact('BKN', 0.001), fact('LAL', 0.005)]);
    const a = applyFactLedger(input, l, candidates);
    const b = applyFactLedger(input, l, candidates);
    expect(a).toEqual(b);
    expect(a.applied.map((f) => f.team)).toEqual(['LAL']);
  });

  it('renormalizes when every candidate is capped', () => {
    const input = odds({ MIA: 0.5, CLE: 0.4, LAL: 0.1 });
    const l = ledger([fact('MIA', 0.2), fact('CLE', 0.2), fact('LAL', 0.05)]);
    const { odds: out } = applyFactLedger(input, l, candidates);
    const sum = candidates.reduce((s, t) => s + out.odds[t], 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(out.odds.MIA).toBeCloseTo(out.odds.CLE, 12); // equal caps → equal shares
  });
});
