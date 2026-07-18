/**
 * WS12-T2 AC (§12.4, INV-7): the single most important test in the wallet-linking workstream —
 * the persisted `wallet_links.enrichment` JSON must never carry a raw dollar amount. Also
 * covers bucket boundaries, chalk/category prior derivation, `first_seen`, and the placement
 * prior blend (§8.7/§12.4 "average if both exist").
 */
import { describe, expect, it } from 'vitest';
import { WALLET_SIZE_BUCKETS } from '@receipts/core';
import type { FingerprintPrior, MarketCategory } from '@receipts/core';
import {
  blendWalletPriorIntoExisting,
  buildWalletEnrichment,
  sizeBucket,
  type WalletPositionInput,
} from '../src/wallet-bucketing.js';

function position(overrides: Partial<WalletPositionInput> = {}): WalletPositionInput {
  return {
    notionalUsd: 50,
    entryProbability: 0.6,
    category: 'sports',
    enteredAt: new Date('2024-11-15T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Recursively collects every numeric leaf value in `obj`, keyed by its dotted path — the
 * privacy-walk primitive. Any object/array is descended into; nothing is skipped.
 */
function collectNumericLeaves(obj: unknown, path = ''): Array<{ path: string; value: number }> {
  if (typeof obj === 'number') return [{ path, value: obj }];
  if (obj === null || obj === undefined || typeof obj !== 'object') return [];
  const out: Array<{ path: string; value: number }> = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...collectNumericLeaves(v, `${path}[${i}]`)));
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    out.push(...collectNumericLeaves(value, path ? `${path}.${key}` : key));
  }
  return out;
}

const ALLOWLISTED_NUMERIC_PATH = /^(trades|chalkPrior|buckets\.\w+|categories\.\w+)$/;

describe('buildWalletEnrichment — privacy (INV-7, §12.4)', () => {
  it('persisted enrichment JSON has no numeric field outside the counts/priors allowlist, and no raw notional survives anywhere in it', () => {
    // Distinctive, individually-identifiable raw dollar amounts — if any of these values (or
    // any close variant of them) shows up anywhere in the persisted object, bucketing leaked.
    const rawNotionals = [123_456.78, 9_999.99, 42.5, 7.13, 8_000_000.01];
    const positions = rawNotionals.map((notionalUsd, i) =>
      position({ notionalUsd, entryProbability: 0.1 * i, category: 'sports' }),
    );

    const { enrichment } = buildWalletEnrichment(positions);

    // 1) Every numeric leaf lives at an allowlisted path (counts or priors only).
    const leaves = collectNumericLeaves(enrichment);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(leaf.path).toMatch(ALLOWLISTED_NUMERIC_PATH);
    }

    // 2) No leaf equals (or nearly equals) any raw input notional — proves the dollar figures
    // themselves were discarded, not merely renamed.
    for (const leaf of leaves) {
      for (const raw of rawNotionals) {
        expect(Math.abs(leaf.value - raw)).toBeGreaterThan(0.001);
      }
    }

    // 3) Belt-and-suspenders: the raw amounts don't appear as substrings of the serialized
    // JSON either (guards against a raw amount leaking through a string field).
    const serialized = JSON.stringify(enrichment);
    for (const raw of rawNotionals) {
      expect(serialized).not.toContain(String(raw));
    }

    // 4) The known-sensitive key does exist (bucket counts are legitimate INTERNAL state) —
    // this test is about VALUES never leaking, not about the key being absent from the
    // persisted row; §12.4's "never serialize `buckets`" rule is a display-layer contract
    // enforced separately (apps/web/lib/serialize-wallet.ts + its own test, WS12-T3).
    expect(enrichment.buckets).toBeDefined();
  });

  it('bucket counts sum to the number of positions', () => {
    const positions = [10, 50, 500, 5000, 50_000].map((notionalUsd) => position({ notionalUsd }));
    const { enrichment } = buildWalletEnrichment(positions);
    const total = Object.values(enrichment.buckets).reduce((a, b) => a + b, 0);
    expect(total).toBe(positions.length);
  });
});

describe('sizeBucket — WALLET_SIZE_BUCKETS boundaries (§12.4, Appendix D)', () => {
  it('assigns xs/s/m/l/xl per the configured bounds', () => {
    expect(sizeBucket(0)).toBe('xs');
    expect(sizeBucket(9.99)).toBe('xs');
    expect(sizeBucket(10)).toBe('s'); // xs bound is exclusive
    expect(sizeBucket(99.99)).toBe('s');
    expect(sizeBucket(100)).toBe('m');
    expect(sizeBucket(999.99)).toBe('m');
    expect(sizeBucket(1_000)).toBe('l');
    expect(sizeBucket(9_999.99)).toBe('l');
    expect(sizeBucket(10_000)).toBe('xl');
    expect(sizeBucket(10_000_000)).toBe('xl');
  });

  it('config bucket bounds are exactly xs/s/m/l/xl in ascending order (sanity on the source of truth)', () => {
    expect(WALLET_SIZE_BUCKETS.map((b) => b.bucket)).toEqual(['xs', 's', 'm', 'l', 'xl']);
  });
});

describe('buildWalletEnrichment — priors', () => {
  it('empty positions: trades 0, chalkPrior null, firstSeen null, all buckets 0, no categoryShares in prior', () => {
    const { enrichment, prior } = buildWalletEnrichment([]);
    expect(enrichment.trades).toBe(0);
    expect(enrichment.chalkPrior).toBeNull();
    expect(enrichment.firstSeen).toBeNull();
    expect(Object.values(enrichment.buckets)).toEqual([0, 0, 0, 0, 0]);
    expect(prior.chalk).toBeUndefined();
    expect(prior.categoryShares).toBeUndefined();
    // §12.3/§12.4: wallet import never seeds timing from the positions endpoint (SPEC-GAP).
    expect(prior.timing).toBeUndefined();
  });

  it('chalk prior is 2*(mean entry probability)-1, matching the §8.1 chalk formula', () => {
    const positions = [position({ entryProbability: 0.9 }), position({ entryProbability: 0.7 })];
    const { enrichment } = buildWalletEnrichment(positions);
    expect(enrichment.chalkPrior).toBeCloseTo(2 * 0.8 - 1, 10); // 0.6
  });

  it('category shares sum to 1 across seen categories', () => {
    const positions: WalletPositionInput[] = [
      position({ category: 'sports' }),
      position({ category: 'sports' }),
      position({ category: 'politics' }),
    ];
    const { enrichment } = buildWalletEnrichment(positions);
    expect(enrichment.categories['sports']).toBeCloseTo(2 / 3, 10);
    expect(enrichment.categories['politics']).toBeCloseTo(1 / 3, 10);
    const sum = Object.values(enrichment.categories).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('firstSeen is the earliest enteredAt month (UTC), ignoring positions with a null timestamp', () => {
    const positions: WalletPositionInput[] = [
      position({ enteredAt: new Date('2025-03-01T00:00:00Z') }),
      position({ enteredAt: new Date('2024-11-20T00:00:00Z') }),
      position({ enteredAt: null }),
    ];
    const { enrichment } = buildWalletEnrichment(positions);
    expect(enrichment.firstSeen).toBe('2024-11');
  });

  it('firstSeen is null when no position carries a timestamp (graceful degrade)', () => {
    const { enrichment } = buildWalletEnrichment([position({ enteredAt: null })]);
    expect(enrichment.firstSeen).toBeNull();
  });
});

describe('blendWalletPriorIntoExisting (§8.7/§12.4 "average if both exist")', () => {
  it('no existing prior: incoming passes through unchanged', () => {
    const incoming: FingerprintPrior = { chalk: 0.4, categoryShares: { sports: 1 } };
    expect(blendWalletPriorIntoExisting(null, incoming)).toEqual(incoming);
  });

  it('both have chalk: averages', () => {
    const existing: FingerprintPrior = { chalk: 0.2 };
    const incoming: FingerprintPrior = { chalk: 0.6 };
    expect(blendWalletPriorIntoExisting(existing, incoming).chalk).toBeCloseTo(0.4, 10);
  });

  it('only existing has an axis: untouched; only incoming has an axis: passed through', () => {
    const existing: FingerprintPrior = { timing: 0.3 };
    const incoming: FingerprintPrior = { chalk: 0.5 };
    const blended = blendWalletPriorIntoExisting(existing, incoming);
    expect(blended.timing).toBe(0.3);
    expect(blended.chalk).toBe(0.5);
  });

  it('category shares blend per-key: shared keys average, unique keys pass through', () => {
    const existing: FingerprintPrior = { categoryShares: { sports: 0.8, politics: 0.2 } };
    const incoming: FingerprintPrior = { categoryShares: { sports: 0.4, science: 0.6 } };
    const blended = blendWalletPriorIntoExisting(existing, incoming);
    const shares = blended.categoryShares as Partial<Record<MarketCategory, number>>;
    expect(shares.sports).toBeCloseTo(0.6, 10);
    expect(shares.politics).toBe(0.2);
    expect(shares.science).toBe(0.6);
  });
});
