/**
 * Kalshi trade API v2 response shapes (design doc §7.3). Trimmed to the fields the adapter
 * actually reads (ToS posture, §5.3 `raw` — full payload never persisted).
 *
 * WS15-T1 (live-verified 2026-07-20 against `api.elections.kalshi.com` AND
 * `demo-api.kalshi.co`): the current API returns dollar-denominated STRING fields
 * (`yes_bid_dollars: "0.9800"`, `liquidity_dollars`, `last_price_dollars`) and has dropped
 * the legacy integer-cents fields (`yes_bid`, `liquidity`, …) plus per-market `category`
 * entirely. Both generations are kept optional here: dollars fields are what production
 * serves today; the cents fields still cover recorded fixtures and any older self-hosted
 * gateway. `fixtures/venue-notes.md` has the field-by-field verification notes.
 */
import { z } from 'zod';

/** Dollar amounts arrive as strings ("0.9800"); tolerate numbers for robustness. */
const dollars = z.union([z.string(), z.number()]).optional().nullable();
/** Fixed-point counts (contracts) arrive as strings ("478.06"); tolerate numbers. */
const fixedPoint = z.union([z.string(), z.number()]).optional().nullable();

export const kalshiMarketSchema = z.object({
  ticker: z.string().min(1),
  event_ticker: z.string().optional(),
  /** Kalshi markets are inherently binary contracts; non-'binary' values are filtered (DD-7). */
  market_type: z.string().optional(),
  title: z.string().min(1),
  /** Absent on the current API (0/3000 in the live scan) — kept for legacy fixtures. */
  category: z.string().optional().nullable(),
  status: z.string(),
  /** '' (unset) | 'yes' | 'no' | 'void' — see resolution mapping SPEC-GAP. */
  result: z.string().optional().nullable(),
  open_time: z.string().optional(),
  close_time: z.string(),
  expiration_time: z.string().optional().nullable(),
  /** Kalshi's own resolve-time estimate; tighter than `expiration_time` (the latest legal one). */
  expected_expiration_time: z.string().optional().nullable(),
  /** Legacy cents [0,100] — absent on the current API. */
  yes_bid: z.number().optional().nullable(),
  yes_ask: z.number().optional().nullable(),
  no_bid: z.number().optional().nullable(),
  no_ask: z.number().optional().nullable(),
  last_price: z.number().optional().nullable(),
  /** Legacy cents (dollar value * 100) — absent on the current API. */
  liquidity: z.number().optional().nullable(),
  volume: z.number().optional().nullable(),
  /** Current-API dollar strings, [0.0000, 1.0000] for prices. */
  yes_bid_dollars: dollars,
  yes_ask_dollars: dollars,
  last_price_dollars: dollars,
  liquidity_dollars: dollars,
  /** Per-contract payout, "1.0000" on standard markets. */
  notional_value_dollars: dollars,
  /** Contracts outstanding — the only reliably-populated activity signal on the public feed. */
  open_interest: z.number().optional().nullable(),
  open_interest_fp: fixedPoint,
  volume_24h: z.number().optional().nullable(),
  volume_24h_fp: fixedPoint,
});

export type KalshiMarket = z.infer<typeof kalshiMarketSchema>;

export const kalshiMarketsResponseSchema = z.object({
  markets: z.array(kalshiMarketSchema),
  cursor: z.string().optional().nullable(),
});

export const kalshiMarketResponseSchema = z.object({
  market: kalshiMarketSchema,
});
