/**
 * Wallet-link domain types (design doc §5.6 `wallet_links`, §12.3–12.4). The pure bucketing
 * computation lives in `packages/engine` (WS12-T2, mirroring `FingerprintVector`'s split); this
 * is the shared persisted shape both the worker (writer) and web (reader/serializer) import
 * without depending on `@receipts/engine` at runtime.
 */
import { WALLET_SIZE_BUCKETS } from '../config.js';
import type { MarketCategory } from '../enums.js';

export type WalletSizeBucket = (typeof WALLET_SIZE_BUCKETS)[number]['bucket'];

export const WALLET_SIZE_BUCKET_KEYS = WALLET_SIZE_BUCKETS.map((b) => b.bucket) as [
  WalletSizeBucket,
  ...WalletSizeBucket[],
];

/**
 * The ONLY shape ever written to `wallet_links.enrichment` (§12.4, INV-7). Bucket bounds are
 * used transiently at ingestion (`packages/engine`) to produce these counts — no raw dollar
 * amount, per-position record, or P&L figure exists anywhere in this object, and `buckets`
 * itself must NEVER be serialized to any client/public API response (exhaustive display
 * allowlist, §12.4 — see `apps/web/lib/serialize-wallet.ts`'s `toWalletBadge`).
 */
export interface WalletEnrichment {
  /** Total imported positions (public-displayable as "N positions", §12.4). */
  trades: number;
  /** Position-count histogram by notional-size bucket. INTERNAL ONLY — never serialized. */
  buckets: Record<WalletSizeBucket, number>;
  /** Category shares (sums to 1 over categories seen), same shape as `FingerprintPrior.categoryShares`. */
  categories: Partial<Record<MarketCategory, number>>;
  /** `2*(mean entry probability)-1`, clamped [-1,1]; null if no positions (§8.1 chalk formula). */
  chalkPrior: number | null;
  /** `YYYY-MM` of the earliest imported position/trade; null if unavailable (§12.4 display). */
  firstSeen: string | null;
}
