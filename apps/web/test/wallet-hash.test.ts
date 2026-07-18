/**
 * WS12-T1 AC: "address case-insensitivity" — `0xABC...` and `0xabc...` must hash identically
 * (both lowercased before hashing). Also: HMAC-keyed, not plain SHA-256 (same posture as
 * `ghost-cookie.ts`).
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashWalletAddress } from '@/lib/wallet-hash';

beforeAll(() => {
  process.env.WALLET_HASH_SECRET = 'unit-test-wallet-hash-secret';
});

const ADDRESS = '0xAbC0000000000000000000000000000000dEaD';

describe('hashWalletAddress (§5.6, §12.5)', () => {
  it('is case-insensitive: differently-cased input hashes identically', () => {
    expect(hashWalletAddress(ADDRESS)).toBe(hashWalletAddress(ADDRESS.toLowerCase()));
    expect(hashWalletAddress(ADDRESS)).toBe(hashWalletAddress(ADDRESS.toUpperCase()));
  });

  it('uses HMAC-SHA256 keyed by WALLET_HASH_SECRET, not plain sha256', () => {
    const hash = hashWalletAddress(ADDRESS);
    const plainSha256 = createHash('sha256').update(ADDRESS.toLowerCase()).digest('hex');
    expect(hash).not.toBe(plainSha256);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different addresses hash differently', () => {
    expect(hashWalletAddress(ADDRESS)).not.toBe(hashWalletAddress('0x0000000000000000000000000000000000dead'));
  });
});
