/**
 * Wallet linking schemas (design doc §12, §9.2). Read-only SIWE proof of address control —
 * no transactions, no approvals, no keys (INV-2). Flag `wallet_linking`.
 */
import { z } from 'zod';
import type { WALLET_SIZE_BUCKET_KEYS } from '../types/wallet.js';
import { MARKET_CATEGORY } from '../enums.js';

export const zEthAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid EOA address');

/**
 * Runtime shape-check for `wallet_links.enrichment` (§12.4, INV-7) — the ONLY jsonb ever
 * persisted there. Used by the worker before writing and by tests walking every persisted
 * shape for stray numeric fields. NEVER exported as part of a client-facing response schema —
 * `buckets` is internal-only (see `walletBadgeSchema` in `schemas/profiles.ts` for the public
 * allowlisted shape instead).
 */
const zBucketCount = z.number().int().nonnegative();

export const walletEnrichmentSchema = z.object({
  trades: z.number().int().nonnegative(),
  buckets: z.object({
    xs: zBucketCount,
    s: zBucketCount,
    m: zBucketCount,
    l: zBucketCount,
    xl: zBucketCount,
  }) satisfies z.ZodType<Record<(typeof WALLET_SIZE_BUCKET_KEYS)[number], number>>,
  categories: z.record(z.enum(MARKET_CATEGORY), z.number().min(0).max(1)),
  chalkPrior: z.number().min(-1).max(1).nullable(),
  firstSeen: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
});

// --- POST /wallet/nonce (claimed) → full SIWE message to sign (§12.2 step 1) ------------------

export const walletNonceBodySchema = z
  .object({
    address: zEthAddress,
  })
  .strict();

export const walletNonceRequestSchema = z.object({ body: walletNonceBodySchema });
export const walletNonceResponseSchema = z.object({
  /** Full EIP-4361 message (pinned statement, chainId 137, single-use nonce). */
  message: z.string(),
});

// --- POST /wallet/verify (claimed) → link result + enrichment summary (§12.2 steps 3–4) -------

export const walletVerifyBodySchema = z
  .object({
    message: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict();

export const walletVerifyRequestSchema = z.object({ body: walletVerifyBodySchema });
export type WalletVerifyBody = z.infer<typeof walletVerifyBodySchema>;

/**
 * Response is intentionally minimal: ingestion is async (§12.2 step 4). Any enrichment summary
 * ever returned obeys the §12.4 public display allowlist — never size buckets (INV-7).
 */
export const walletVerifyResponseSchema = z.object({
  status: z.literal('linked'),
  ingestion: z.literal('pending'),
});

// --- DELETE /wallet (claimed): unlink; deletes enrichment (§12.5) -----------------------------

export const walletUnlinkRequestSchema = z.object({});
export const walletUnlinkResponseSchema = z.object({ unlinked: z.literal(true) });
