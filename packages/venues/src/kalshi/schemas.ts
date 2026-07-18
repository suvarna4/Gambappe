/**
 * Kalshi trade API v2 response shapes (design doc §7.3). Trimmed to the fields the adapter
 * actually reads (ToS posture, §5.3 `raw` — full payload never persisted). Endpoint/field
 * shapes are our best-effort reconstruction from Kalshi's public v2 REST docs; live
 * verification was not possible in this sandbox (no network egress) — see
 * `fixtures/venue-notes.md` SPEC-GAP note.
 */
import { z } from 'zod';

export const kalshiMarketSchema = z.object({
  ticker: z.string().min(1),
  event_ticker: z.string().optional(),
  /** Kalshi markets are inherently binary contracts; non-'binary' values are filtered (DD-7). */
  market_type: z.string().optional(),
  title: z.string().min(1),
  category: z.string().optional().nullable(),
  status: z.string(),
  /** '' (unset) | 'yes' | 'no' | 'void' — see resolution mapping SPEC-GAP. */
  result: z.string().optional().nullable(),
  open_time: z.string().optional(),
  close_time: z.string(),
  expiration_time: z.string().optional().nullable(),
  /** Cents [0,100]. */
  yes_bid: z.number().optional().nullable(),
  yes_ask: z.number().optional().nullable(),
  no_bid: z.number().optional().nullable(),
  no_ask: z.number().optional().nullable(),
  last_price: z.number().optional().nullable(),
  /** Cents (dollar value * 100). */
  liquidity: z.number().optional().nullable(),
  volume: z.number().optional().nullable(),
});

export type KalshiMarket = z.infer<typeof kalshiMarketSchema>;

export const kalshiMarketsResponseSchema = z.object({
  markets: z.array(kalshiMarketSchema),
  cursor: z.string().optional().nullable(),
});

export const kalshiMarketResponseSchema = z.object({
  market: kalshiMarketSchema,
});
