/**
 * Wallet badge serialization (design doc §12.4–12.5) — the EXHAUSTIVE public display allowlist:
 * verified badge, `first_seen` month, position count, address (only when opted in). The
 * size-bucket histogram (`wallet_links.enrichment.buckets`) and every other internal field
 * (categories, chalkPrior) NEVER leave this function — `walletBadgeSchema` (packages/core)
 * doesn't even have a slot for them. `GET /profiles/:slug` (WS7-T4, not built this wave) should
 * call this rather than hand-rolling its own wallet projection, so the allowlist has exactly
 * one implementation.
 */
import type { z } from 'zod';
import type { walletBadgeSchema } from '@receipts/core';
import type { WalletLinkRow } from '@receipts/db';

export type WalletBadge = z.infer<typeof walletBadgeSchema>;

export function toWalletBadge(link: WalletLinkRow | null, showAddress: boolean): WalletBadge | null {
  if (!link || link.status !== 'active') return null;
  const enrichment = link.enrichment as { trades?: number; firstSeen?: string | null } | null;
  return {
    verified: true,
    first_seen: enrichment?.firstSeen ?? null,
    position_count: enrichment?.trades ?? null,
    address: showAddress ? link.address : null,
  };
}
