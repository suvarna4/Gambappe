/**
 * WS12-T3 AC (§12.4 exhaustive public display allowlist, INV-7): "serialization test — no API
 * response anywhere contains a `buckets` key." Walks `toWalletBadge`'s output (the one place a
 * `wallet_links` row is ever projected toward a client) AND every wallet route's literal
 * response envelope, feeding in a wallet row whose `enrichment` DOES contain `buckets` — proving
 * the leak-prone field is actively stripped, not just absent by coincidence.
 */
import { describe, expect, it } from 'vitest';
import {
  walletNonceResponseSchema,
  walletUnlinkResponseSchema,
  walletVerifyResponseSchema,
} from '@receipts/core';
import type { WalletLinkRow } from '@receipts/db';
import { toWalletBadge } from '@/lib/serialize-wallet';

/** Recursively collects every key name found anywhere in `obj` (objects and arrays). */
function collectAllKeys(obj: unknown, acc: Set<string> = new Set()): Set<string> {
  if (obj === null || obj === undefined || typeof obj !== 'object') return acc;
  if (Array.isArray(obj)) {
    for (const v of obj) collectAllKeys(v, acc);
    return acc;
  }
  for (const [key, value] of Object.entries(obj)) {
    acc.add(key);
    collectAllKeys(value, acc);
  }
  return acc;
}

function fakeWalletLinkRow(overrides: Partial<WalletLinkRow> = {}): WalletLinkRow {
  return {
    id: 'wl-1',
    profileId: 'profile-1',
    address: '0xabc0000000000000000000000000000000dead',
    addressHash: 'hash',
    proxyAddress: null,
    verifiedAt: new Date('2026-07-18T00:00:00Z'),
    status: 'active',
    enrichment: {
      trades: 142,
      buckets: { xs: 1, s: 2, m: 3, l: 4, xl: 5 },
      categories: { sports: 0.5, politics: 0.5 },
      chalkPrior: 0.18,
      firstSeen: '2024-11',
    },
    unlinkedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-18T00:00:00Z'),
    ...overrides,
  } as WalletLinkRow;
}

describe('toWalletBadge — §12.4 exhaustive allowlist (INV-7)', () => {
  it('never carries a `buckets` key, even when the source row has one', () => {
    const badge = toWalletBadge(fakeWalletLinkRow(), true);
    expect(badge).not.toBeNull();
    const keys = collectAllKeys(badge);
    expect(keys.has('buckets')).toBe(false);
    expect(JSON.stringify(badge)).not.toContain('buckets');
  });

  it('never carries `categories` or `chalkPrior` either — the allowlist is exhaustive, not just bucket-shaped', () => {
    const badge = toWalletBadge(fakeWalletLinkRow(), true);
    const keys = collectAllKeys(badge);
    expect(keys.has('categories')).toBe(false);
    expect(keys.has('chalkPrior')).toBe(false);
    expect(keys.has('chalk_prior')).toBe(false);
  });

  it('output is EXACTLY the four allowlisted keys — nothing more', () => {
    const badge = toWalletBadge(fakeWalletLinkRow(), true);
    expect(Object.keys(badge!).sort()).toEqual(['address', 'first_seen', 'position_count', 'verified']);
  });

  it('address is null unless showAddress is true (§12.5 separate opt-in)', () => {
    expect(toWalletBadge(fakeWalletLinkRow(), false)!.address).toBeNull();
    expect(toWalletBadge(fakeWalletLinkRow(), true)!.address).toBe('0xabc0000000000000000000000000000000dead');
  });

  it('an unlinked (non-active) link never serializes to a badge at all', () => {
    expect(toWalletBadge(fakeWalletLinkRow({ status: 'unlinked' }), true)).toBeNull();
  });

  it('no wallet link at all -> null badge', () => {
    expect(toWalletBadge(null, true)).toBeNull();
  });
});

describe('wallet route response envelopes — no `buckets` key anywhere (§12.4)', () => {
  it('POST /wallet/nonce response shape', () => {
    const parsed = walletNonceResponseSchema.parse({ message: 'irrelevant for this test' });
    expect(collectAllKeys(parsed).has('buckets')).toBe(false);
  });

  it('POST /wallet/verify response shape', () => {
    const parsed = walletVerifyResponseSchema.parse({ status: 'linked', ingestion: 'pending' });
    expect(collectAllKeys(parsed).has('buckets')).toBe(false);
  });

  it('DELETE /wallet response shape', () => {
    const parsed = walletUnlinkResponseSchema.parse({ unlinked: true });
    expect(collectAllKeys(parsed).has('buckets')).toBe(false);
  });
});
