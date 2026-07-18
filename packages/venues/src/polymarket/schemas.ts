/**
 * Polymarket Gamma + CLOB response shapes (design doc §7.4). Trimmed to fields the adapter
 * reads (ToS posture, §5.3 `raw`). Best-effort reconstruction from public docs; live
 * verification was not possible in this sandbox — see `fixtures/venue-notes.md` SPEC-GAP.
 */
import { z } from 'zod';

/**
 * Gamma has historically encoded some array fields (`outcomes`, `outcomePrices`,
 * `clobTokenIds`) as JSON-stringified strings rather than native JSON arrays; accept both
 * shapes defensively (unverified live, see venue-notes.md).
 */
const jsonArrayOfStrings = z.union([
  z.array(z.string()),
  z.string().transform((raw, ctx) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed.map((v) => String(v));
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid JSON array string: ${String(err)}`,
      });
      return z.NEVER;
    }
  }),
]);

export const polymarketGammaMarketSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  slug: z.string().optional(),
  category: z.string().optional().nullable(),
  endDate: z.string(),
  liquidity: z.union([z.string(), z.number()]).optional().nullable(),
  volume: z.union([z.string(), z.number()]).optional().nullable(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional(),
  outcomes: jsonArrayOfStrings.optional(),
  outcomePrices: jsonArrayOfStrings.optional(),
  clobTokenIds: jsonArrayOfStrings.optional(),
  /** e.g. 'resolved' | 'proposed' | 'disputed' | 'challenged' — unverified (SPEC-GAP). */
  umaResolutionStatus: z.string().optional().nullable(),
});

export type PolymarketGammaMarket = z.infer<typeof polymarketGammaMarketSchema>;

export const polymarketGammaMarketsResponseSchema = z.array(polymarketGammaMarketSchema);

export const polymarketClobMidpointSchema = z.object({
  mid: z.union([z.string(), z.number()]),
});

export type PolymarketClobMidpoint = z.infer<typeof polymarketClobMidpointSchema>;
