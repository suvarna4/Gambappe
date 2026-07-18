/**
 * WS12-T2 AC: proxy resolution falls back gracefully to EOA-only (`proxyAddress: null,
 * verified: false`) while the real Polymarket factory constants remain unverified/unset
 * (SPEC-GAP, see `src/polymarket/proxy.ts`'s module comment) — the "graceful fallback path"
 * acceptance criterion. Also exercises the CREATE2 math itself for determinism/format
 * correctness (self-consistency, since the real factory address can't be verified live here).
 */
import { describe, expect, it } from 'vitest';
import { getAddress, getContractAddress, isAddress, type Address, type Hex } from 'viem';
import {
  POLYMARKET_PROXY_FACTORY_ADDRESS,
  POLYMARKET_PROXY_INIT_CODE_HASH,
  computeCreate2ProxyAddress,
  resolvePolymarketProxy,
  saltFromOwner,
} from '../src/polymarket/proxy.js';

const EOA: Address = getAddress(`0x${'1'.repeat(40)}`);
const ANOTHER_EOA: Address = getAddress(`0x${'2'.repeat(40)}`);
const FAKE_FACTORY: Address = getAddress(`0x${'f'.repeat(40)}`);
const FAKE_INIT_CODE_HASH: Hex =
  '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex;

describe('resolvePolymarketProxy — SAFE DEFAULT fallback (§12.3)', () => {
  it('the real factory constants are unset (unverified) — documented, not accidental', () => {
    expect(POLYMARKET_PROXY_FACTORY_ADDRESS).toBeNull();
    expect(POLYMARKET_PROXY_INIT_CODE_HASH).toBeNull();
  });

  it('resolves to the EOA-only fallback: proxyAddress null, verified false, reason present', () => {
    const result = resolvePolymarketProxy(EOA);
    expect(result.proxyAddress).toBeNull();
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/SPEC-GAP\(WS12-T2\)/);
  });

  it('the fallback is deterministic and address-independent (always the same shape)', () => {
    expect(resolvePolymarketProxy(EOA)).toEqual(resolvePolymarketProxy(ANOTHER_EOA));
  });
});

describe('computeCreate2ProxyAddress — CREATE2 math (EIP-1014, via viem)', () => {
  it('produces a checksummed, valid address', () => {
    const salt = saltFromOwner(EOA);
    const address = computeCreate2ProxyAddress(FAKE_FACTORY, salt, FAKE_INIT_CODE_HASH);
    expect(isAddress(address)).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const salt = saltFromOwner(EOA);
    const a = computeCreate2ProxyAddress(FAKE_FACTORY, salt, FAKE_INIT_CODE_HASH);
    const b = computeCreate2ProxyAddress(FAKE_FACTORY, salt, FAKE_INIT_CODE_HASH);
    expect(a).toBe(b);
  });

  it('different owners (different salts) derive different proxy addresses', () => {
    const a = computeCreate2ProxyAddress(FAKE_FACTORY, saltFromOwner(EOA), FAKE_INIT_CODE_HASH);
    const b = computeCreate2ProxyAddress(FAKE_FACTORY, saltFromOwner(ANOTHER_EOA), FAKE_INIT_CODE_HASH);
    expect(a).not.toBe(b);
  });

  it('matches an independent call to viem.getContractAddress with the same opts (wiring check)', () => {
    const salt = saltFromOwner(EOA);
    const expected = getContractAddress({
      opcode: 'CREATE2',
      from: FAKE_FACTORY,
      salt,
      bytecodeHash: FAKE_INIT_CODE_HASH,
    });
    expect(computeCreate2ProxyAddress(FAKE_FACTORY, salt, FAKE_INIT_CODE_HASH)).toBe(expected);
  });
});
