/**
 * WS12-T1: SIWE message build/parse round-trip + the malformed/tampered-input rejections that
 * back `/wallet/verify`'s domain/nonce/expiry/address re-checks (§12.2 step 3).
 */
import { describe, expect, it } from 'vitest';
import {
  WALLET_SIWE_CHAIN_ID,
  WALLET_SIWE_STATEMENT,
  buildSiweMessage,
  parseSiweMessage,
  type SiweMessageFields,
} from '@/lib/siwe';

function fields(overrides: Partial<SiweMessageFields> = {}): SiweMessageFields {
  return {
    domain: 'receipts.example',
    address: '0xabc0000000000000000000000000000000dead',
    statement: WALLET_SIWE_STATEMENT,
    uri: 'https://receipts.example',
    chainId: WALLET_SIWE_CHAIN_ID,
    nonce: 'abc123',
    issuedAt: new Date('2026-07-18T12:00:00Z'),
    expirationTime: new Date('2026-07-18T12:10:00Z'),
    ...overrides,
  };
}

describe('buildSiweMessage / parseSiweMessage — round trip (§12.2)', () => {
  it('parses back exactly what was built, including the pinned statement verbatim', () => {
    const f = fields();
    const message = buildSiweMessage(f);
    const parsed = parseSiweMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(f);
    expect(parsed!.statement).toBe(
      "Link this wallet to Receipts to verify your Polymarket record. This signature is proof of ownership only — it cannot move funds or authorize anything.",
    );
  });

  it('pins chainId 137 as the module constant', () => {
    expect(WALLET_SIWE_CHAIN_ID).toBe(137);
  });
});

describe('parseSiweMessage — malformed/tampered input', () => {
  it('rejects a message with the wrong number of lines', () => {
    expect(parseSiweMessage('not a siwe message')).toBeNull();
  });

  it('rejects a non-"Version: 1" message', () => {
    const message = buildSiweMessage(fields()).replace('Version: 1', 'Version: 2');
    expect(parseSiweMessage(message)).toBeNull();
  });

  it('rejects an unparseable Issued At / Expiration Time', () => {
    const message = buildSiweMessage(fields()).replace(/Issued At: .+/, 'Issued At: not-a-date');
    expect(parseSiweMessage(message)).toBeNull();
  });

  it('round-trips a tampered domain so callers can detect the mismatch themselves', () => {
    // The parser itself doesn't know the "expected" domain — that check is the caller's job
    // (`/wallet/verify` compares `parsed.domain` against its own app host). Here we just prove
    // a different domain parses to a DIFFERENT value than what the server would expect.
    const message = buildSiweMessage(fields({ domain: 'evil.example' }));
    const parsed = parseSiweMessage(message);
    expect(parsed!.domain).toBe('evil.example');
    expect(parsed!.domain).not.toBe('receipts.example');
  });

  it('empty string is rejected, never throws', () => {
    expect(() => parseSiweMessage('')).not.toThrow();
    expect(parseSiweMessage('')).toBeNull();
  });
});
