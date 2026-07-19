/**
 * EIP-4361 (SIWE) message build/parse (design doc §12.2). Framework-agnostic (no next-auth/
 * next/server import) — same posture as `identity.ts`: pure string in/out, unit-testable
 * without a Next.js runtime. `wallet/nonce/route.ts` builds a message with `buildSiweMessage`;
 * `wallet/verify/route.ts` re-parses the client-returned message with `parseSiweMessage` to
 * re-check domain/nonce/expiry/address before ever calling into signature verification —
 * never trusts fields the client could have tampered with without that re-check.
 *
 * This hand-rolled parser is intentionally narrow: it only needs to round-trip messages THIS
 * server generated (`buildSiweMessage`'s exact template), not arbitrary ABNF-compliant SIWE
 * text from third-party libraries — SPEC-GAP(WS12-T1): a full ERC-4361 ABNF parser (e.g. the
 * `siwe` npm package) would be more permissive, but isn't needed for our own round-trip and
 * keeps the dependency surface to just `viem` (§3 tech stack).
 */

import { PRODUCT_NAME } from '@receipts/core';

/** Pinned wording (§12.2) — the product name interpolates from PRODUCT_NAME; never edit the
 * surrounding sentence without updating this comment + the design doc. */
export const WALLET_SIWE_STATEMENT =
  `Link this wallet to ${PRODUCT_NAME} to verify your Polymarket record. This signature is proof of ownership only — it cannot move funds or authorize anything.`;

/** Polymarket is Polygon-mainnet only at MVP (§12.2). */
export const WALLET_SIWE_CHAIN_ID = 137;

export interface SiweMessageFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
}

/** The canonical ERC-4361 message template, built from `fields`. */
export function buildSiweMessage(fields: SiweMessageFields): string {
  return [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    '',
    fields.statement,
    '',
    `URI: ${fields.uri}`,
    'Version: 1',
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expirationTime.toISOString()}`,
  ].join('\n');
}

export interface ParsedSiweMessage {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
}

const LINE_PATTERNS = {
  domain: /^(.+) wants you to sign in with your Ethereum account:$/,
  uri: /^URI: (.+)$/,
  version: /^Version: (.+)$/,
  chainId: /^Chain ID: (.+)$/,
  nonce: /^Nonce: (.+)$/,
  issuedAt: /^Issued At: (.+)$/,
  expirationTime: /^Expiration Time: (.+)$/,
};

/**
 * Re-parses a message built by `buildSiweMessage`. Returns `null` on ANY structural mismatch
 * (never throws) — malformed input is always a caller-facing `SIGNATURE_INVALID`, never a 500.
 */
export function parseSiweMessage(message: string): ParsedSiweMessage | null {
  const lines = message.split('\n');
  if (lines.length !== 11) return null;

  const domainMatch = LINE_PATTERNS.domain.exec(lines[0] ?? '');
  const address = lines[1];
  const blank1 = lines[2];
  const statement = lines[3];
  const blank2 = lines[4];
  const uriMatch = LINE_PATTERNS.uri.exec(lines[5] ?? '');
  const versionMatch = LINE_PATTERNS.version.exec(lines[6] ?? '');
  const chainIdMatch = LINE_PATTERNS.chainId.exec(lines[7] ?? '');
  const nonceMatch = LINE_PATTERNS.nonce.exec(lines[8] ?? '');
  const issuedAtMatch = LINE_PATTERNS.issuedAt.exec(lines[9] ?? '');
  const expirationTimeMatch = LINE_PATTERNS.expirationTime.exec(lines[10] ?? '');

  if (
    !domainMatch ||
    !address ||
    blank1 !== '' ||
    !statement ||
    blank2 !== '' ||
    !uriMatch ||
    !versionMatch ||
    versionMatch[1] !== '1' ||
    !chainIdMatch ||
    !nonceMatch ||
    !issuedAtMatch ||
    !expirationTimeMatch
  ) {
    return null;
  }

  const chainId = Number(chainIdMatch[1]);
  const issuedAt = new Date(issuedAtMatch[1]!);
  const expirationTime = new Date(expirationTimeMatch[1]!);
  if (!Number.isFinite(chainId) || Number.isNaN(issuedAt.getTime()) || Number.isNaN(expirationTime.getTime())) {
    return null;
  }

  return {
    domain: domainMatch[1]!,
    address,
    statement,
    uri: uriMatch[1]!,
    chainId,
    nonce: nonceMatch[1]!,
    issuedAt,
    expirationTime,
  };
}
