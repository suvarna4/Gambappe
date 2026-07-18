/**
 * Wallet linking schemas (design doc §12, §9.2). Read-only SIWE proof of address control —
 * no transactions, no approvals, no keys (INV-2). Flag `wallet_linking`.
 */
import { z } from 'zod';

export const zEthAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid EOA address');

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
