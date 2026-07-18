/**
 * Wallet-link business logic (design doc §12.2, §12.5), kept independent of the HTTP layer
 * (takes a `Db` + plain input, no `Request`/`NextResponse`/live Redis/live Polygon RPC) so it's
 * directly unit/integration-testable — same split as `claim-flow.ts` vs `claim/route.ts`. The
 * three wallet route files (nonce/verify/route.ts, wallet/route.ts) are thin adapters around
 * these functions.
 */
import { randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import {
  ApiError,
  SIWE_NONCE_TTL_MIN,
  WALLET_RELINK_COOLDOWN_D,
  type WalletVerifyBody,
} from '@receipts/core';
import {
  getActiveWalletLinkByProfileId,
  getMostRecentWalletLinkByAddressHash,
  insertWalletLink,
  isUniqueViolation,
  unlinkWalletLink,
  upsertFingerprintPrior,
  type Db,
} from '@receipts/db';
import { WALLET_SIWE_CHAIN_ID, WALLET_SIWE_STATEMENT, buildSiweMessage, parseSiweMessage } from './siwe';
import { hashWalletAddress } from './wallet-hash';
import type { WalletNonceStore } from './wallet-nonce-store';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface BuildNonceInput {
  profileId: string;
  address: string;
  appUrl: string;
}

export interface BuildNonceDeps {
  nonceStore: WalletNonceStore;
  at: Date;
}

export interface BuildNonceResult {
  message: string;
}

/** `POST /wallet/nonce` core logic (§12.2 step 1). */
export async function buildWalletNonceMessage(
  input: BuildNonceInput,
  deps: BuildNonceDeps,
): Promise<BuildNonceResult> {
  const address = input.address.toLowerCase();
  const nonce = randomBytes(16).toString('hex');
  const message = buildSiweMessage({
    domain: new URL(input.appUrl).host,
    address,
    statement: WALLET_SIWE_STATEMENT,
    uri: input.appUrl,
    chainId: WALLET_SIWE_CHAIN_ID,
    nonce,
    issuedAt: deps.at,
    expirationTime: new Date(deps.at.getTime() + SIWE_NONCE_TTL_MIN * 60_000),
  });
  await deps.nonceStore.save(nonce, input.profileId, SIWE_NONCE_TTL_MIN * 60);
  return { message };
}

export interface VerifyWalletLinkInput {
  profileId: string;
  body: WalletVerifyBody;
  appUrl: string;
}

export interface VerifyWalletLinkDeps {
  db: Db;
  nonceStore: WalletNonceStore;
  /** Injected so tests never need a live Polygon RPC. */
  verifySignature: (input: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>;
  at: Date;
}

export interface VerifyWalletLinkResult {
  status: 'linked';
  ingestion: 'pending';
  walletLinkId: string;
}

/** `POST /wallet/verify` core logic (§12.2 steps 3–4, minus the job enqueue — route-level side effect). */
export async function verifyWalletLink(
  input: VerifyWalletLinkInput,
  deps: VerifyWalletLinkDeps,
): Promise<VerifyWalletLinkResult> {
  const parsed = parseSiweMessage(input.body.message);
  if (!parsed) throw new ApiError('SIGNATURE_INVALID', 'malformed SIWE message');

  const expectedDomain = new URL(input.appUrl).host;
  if (parsed.domain !== expectedDomain) throw new ApiError('SIGNATURE_INVALID', 'domain mismatch');
  if (parsed.uri !== input.appUrl) throw new ApiError('SIGNATURE_INVALID', 'uri mismatch');
  if (parsed.statement !== WALLET_SIWE_STATEMENT) {
    throw new ApiError('SIGNATURE_INVALID', 'unexpected statement');
  }
  if (parsed.chainId !== WALLET_SIWE_CHAIN_ID) throw new ApiError('SIGNATURE_INVALID', 'chain id mismatch');
  if (!ETH_ADDRESS_RE.test(parsed.address)) throw new ApiError('SIGNATURE_INVALID', 'invalid address in message');

  if (deps.at.getTime() > parsed.expirationTime.getTime()) {
    throw new ApiError('NONCE_EXPIRED', 'SIWE message expired');
  }

  const boundProfileId = await deps.nonceStore.consume(parsed.nonce);
  if (boundProfileId === null) throw new ApiError('NONCE_EXPIRED', 'nonce missing, expired, or already used');
  if (boundProfileId !== input.profileId) {
    throw new ApiError('SIGNATURE_INVALID', 'nonce was not issued to this session');
  }

  const signature = input.body.signature;
  if (!signature.startsWith('0x')) throw new ApiError('SIGNATURE_INVALID', 'signature must be 0x-prefixed');
  const verified = await deps.verifySignature({
    address: parsed.address as `0x${string}`,
    message: input.body.message,
    signature: signature as `0x${string}`,
  });
  if (!verified) throw new ApiError('SIGNATURE_INVALID', 'signature verification failed');

  const address = parsed.address.toLowerCase();
  const addressHash = hashWalletAddress(address);

  // Relink cooldown (§12.5): only `address_hash` survives an unlink, specifically to rate-limit
  // this exact address being re-linked (by anyone) too soon after it was last unlinked.
  const mostRecent = await getMostRecentWalletLinkByAddressHash(deps.db, addressHash);
  if (mostRecent?.status === 'unlinked' && mostRecent.unlinkedAt) {
    const cooldownMs = WALLET_RELINK_COOLDOWN_D * 24 * 60 * 60 * 1000;
    if (deps.at.getTime() - mostRecent.unlinkedAt.getTime() < cooldownMs) {
      throw new ApiError('WALLET_RELINK_COOLDOWN', 'this address was recently unlinked; try again later');
    }
  }
  if (mostRecent?.status === 'active') {
    throw new ApiError('WALLET_ALREADY_LINKED', 'this address is already linked to another profile');
  }

  const existingActive = await getActiveWalletLinkByProfileId(deps.db, input.profileId);
  if (existingActive) {
    throw new ApiError('WALLET_ALREADY_LINKED', 'this profile already has an active wallet link');
  }

  let inserted;
  try {
    inserted = await insertWalletLink(deps.db, {
      id: uuidv7(),
      profileId: input.profileId,
      address,
      addressHash,
      proxyAddress: null,
      verifiedAt: deps.at,
      status: 'active',
      enrichment: null,
      unlinkedAt: null,
    });
  } catch (err) {
    // Defense-in-depth against the TOCTOU race the pre-checks above can't fully close.
    if (isUniqueViolation(err)) throw new ApiError('WALLET_ALREADY_LINKED', 'this address is already linked');
    throw err;
  }

  return { status: 'linked', ingestion: 'pending', walletLinkId: inserted.id };
}

export interface UnlinkWalletDeps {
  db: Db;
  at: Date;
}

/**
 * `DELETE /wallet` core logic (§12.5). SPEC-GAP(WS12-T3): recomputing `placement_prior`
 * without the wallet contribution but WITH any placement-only prior would need WS4-T8's
 * placement-prior derivation helper, not merged into this branch as of this task — nulls
 * `placement_prior` cleanly instead of half-implementing that recompute.
 */
export async function unlinkWallet(profileId: string, deps: UnlinkWalletDeps): Promise<{ unlinked: true }> {
  const active = await getActiveWalletLinkByProfileId(deps.db, profileId);
  if (!active) throw new ApiError('NOT_FOUND', 'no active wallet link for this profile');

  await unlinkWalletLink(deps.db, active.id, deps.at);
  await upsertFingerprintPrior(deps.db, profileId, null, deps.at);

  return { unlinked: true };
}
