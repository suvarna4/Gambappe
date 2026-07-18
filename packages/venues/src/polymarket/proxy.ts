/**
 * Polymarket proxy-wallet resolution (design doc §12.3). Polymarket user funds/positions sit
 * in a Gnosis-Safe-style proxy contract, deployed via CREATE2 from a documented proxy factory,
 * owned by the linking EOA. `wallet:ingest` (WS12-T2) is supposed to check activity for BOTH
 * the EOA and its derived proxy.
 *
 * **SPEC-GAP(WS12-T2) — proxy factory constants are UNVERIFIED and intentionally left unset.**
 * This sandbox has no network egress to Polymarket's docs/contracts (see
 * `fixtures/venue-notes.md`), and the design doc is explicit: the factory address + init code
 * hash "change rarely but must not be guessed." Rather than hardcode a possibly-wrong address,
 * `POLYMARKET_PROXY_FACTORY_ADDRESS`/`POLYMARKET_PROXY_INIT_CODE_HASH` below are `null`, and
 * `resolvePolymarketProxy` takes the doc's own documented fallback path whenever either is
 * unset: "query the data API for the EOA address only, and the badge reads 'wallet verified'
 * without imported history" (§12.3). That fallback is therefore this module's SAFE DEFAULT,
 * not an error path — `wallet:ingest` must treat `{proxyAddress: null, verified: false}` as a
 * normal, expected result, never as a failure to retry.
 *
 * The CREATE2 math itself (`computeCreate2ProxyAddress`) is fully implemented and unit-tested
 * against viem's own address derivation for determinism/format — a human who later obtains and
 * verifies the real factory address + init code hash (and, if it differs from the common
 * Gnosis-Safe-proxy convention assumed here, the salt derivation in `saltFromOwner`) only needs
 * to fill in the two constants below; no other code changes.
 */
import { encodePacked, getContractAddress, keccak256, type Address, type Hex } from 'viem';

/** UNVERIFIED — see module SPEC-GAP above. Fill in only once confirmed against live docs/contracts. */
export const POLYMARKET_PROXY_FACTORY_ADDRESS: Address | null = null;
/** UNVERIFIED — keccak256 of the proxy contract's init code, per the documented CREATE2 scheme. */
export const POLYMARKET_PROXY_INIT_CODE_HASH: Hex | null = null;

/**
 * Best-effort convention for a Gnosis-Safe-style "one proxy per owner" factory: CREATE2 salt =
 * `keccak256(abi.encodePacked(ownerAddress))`. UNVERIFIED against Polymarket's actual factory
 * contract — recorded here only so the derivation is structurally complete once the two
 * constants above are filled in; if Polymarket's real salt scheme differs (e.g. includes a
 * nonce or a different encoding), only this function needs to change.
 */
export function saltFromOwner(owner: Address): Hex {
  return keccak256(encodePacked(['address'], [owner]));
}

/** Pure CREATE2 address derivation (EIP-1014) via viem — the general-purpose primitive. */
export function computeCreate2ProxyAddress(factory: Address, salt: Hex, initCodeHash: Hex): Address {
  return getContractAddress({ opcode: 'CREATE2', from: factory, salt, bytecodeHash: initCodeHash });
}

export interface ProxyResolution {
  proxyAddress: Address | null;
  /** True only once real, confirmed factory constants are wired in (never true today). */
  verified: boolean;
  /** Present on the fallback path — explains why no proxy was derived. */
  reason?: string;
}

/**
 * Resolves `eoa`'s Polymarket proxy contract address (§12.3). Returns the documented fallback
 * (`proxyAddress: null, verified: false`) whenever the factory constants are unset — which is
 * always, today (see module SPEC-GAP). `wallet:ingest` queries the data API for the EOA alone
 * in that case; the wallet still links and verifies, just without imported history/priors.
 */
export function resolvePolymarketProxy(eoa: Address): ProxyResolution {
  if (!POLYMARKET_PROXY_FACTORY_ADDRESS || !POLYMARKET_PROXY_INIT_CODE_HASH) {
    return {
      proxyAddress: null,
      verified: false,
      reason:
        'SPEC-GAP(WS12-T2): Polymarket proxy factory constants unverified — EOA-only fallback (§12.3)',
    };
  }
  const salt = saltFromOwner(eoa);
  const proxyAddress = computeCreate2ProxyAddress(
    POLYMARKET_PROXY_FACTORY_ADDRESS,
    salt,
    POLYMARKET_PROXY_INIT_CODE_HASH,
  );
  return { proxyAddress, verified: true };
}
