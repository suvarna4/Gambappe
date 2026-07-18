/**
 * Polymarket public Data API client (design doc §12.3–12.4, Appendix B `POLYMARKET_DATA_BASE`).
 * Read-only position/trade history for wallet-import enrichment — a SEPARATE client from
 * `adapter.ts`'s Gamma/CLOB (market curation/pricing); this one serves `wallet:ingest`
 * (WS12-T2) only. Reuses the shared venue HTTP client (`../http-client.js`, timeout/retry/
 * jittered backoff) rather than bespoke fetch logic, per the same posture as the real
 * Kalshi/Polymarket market adapters.
 *
 * **SPEC-GAP(WS12-T2) — response shape unverified.** No network egress to
 * data-api.polymarket.com is available in this sandbox (see `fixtures/venue-notes.md`); the
 * schemas below are a best-effort reconstruction from training-data knowledge of Polymarket's
 * public positions/activity endpoints, not a live-verified contract. Every field beyond what's
 * strictly needed is optional so an unexpected-but-plausible real shape degrades gracefully
 * (missing/odd fields → that position contributes less to the derived prior, never a thrown
 * error) rather than breaking ingestion outright. Callers must re-verify this file against a
 * live response before relying on it for anything beyond the best-effort priors described in
 * §12.4.
 */
import { z } from 'zod';
import { createVenueHttpClient, VenueHttpError, type VenueHttpClient } from '../http-client.js';

/**
 * One imported position (`GET {base}/positions?user={address}`). `size`/`avgPrice`/
 * `initialValue` are read ONLY to compute a bucket + entry probability in `wallet:ingest` — the
 * raw numbers themselves are never persisted (INV-7).
 */
export const polymarketPositionSchema = z.object({
  conditionId: z.string().optional(),
  asset: z.string().optional(),
  title: z.string().optional().nullable(),
  /** Free-text category/slug hint — mapped via `mapPolymarketCategory` at the call site. */
  category: z.string().optional().nullable(),
  outcome: z.string().optional().nullable(),
  /** Shares held. */
  size: z.union([z.string(), z.number()]).optional(),
  /** Average entry price, expected in [0,1]. */
  avgPrice: z.union([z.string(), z.number()]).optional(),
  /** USD notional at entry (≈ size × avgPrice) — the value bucketed at ingestion, then discarded. */
  initialValue: z.union([z.string(), z.number()]).optional(),
});
export type PolymarketPosition = z.infer<typeof polymarketPositionSchema>;
const polymarketPositionsResponseSchema = z.array(polymarketPositionSchema);

/** One trade/activity record (`GET {base}/activity?user={address}`) — best-effort timing only. */
export const polymarketActivitySchema = z.object({
  type: z.string().optional(),
  conditionId: z.string().optional(),
  title: z.string().optional().nullable(),
  outcome: z.string().optional().nullable(),
  price: z.union([z.string(), z.number()]).optional(),
  usdcSize: z.union([z.string(), z.number()]).optional(),
  /** Unix seconds. */
  timestamp: z.union([z.string(), z.number()]).optional(),
});
export type PolymarketActivity = z.infer<typeof polymarketActivitySchema>;
const polymarketActivityResponseSchema = z.array(polymarketActivitySchema);

export interface PolymarketDataApiOptions {
  /** Defaults to env `POLYMARKET_DATA_BASE` (Appendix B). */
  dataBaseUrl?: string;
  http?: VenueHttpClient;
}

function resolveBase(explicit: string | undefined): string {
  const base = explicit ?? process.env.POLYMARKET_DATA_BASE;
  if (!base) {
    throw new Error('PolymarketDataApiClient: POLYMARKET_DATA_BASE is not set (see .env.example)');
  }
  return base.replace(/\/$/, '');
}

export class PolymarketDataApiClient {
  private readonly base: string;
  private readonly http: VenueHttpClient;

  constructor(options: PolymarketDataApiOptions = {}) {
    this.base = resolveBase(options.dataBaseUrl);
    this.http = options.http ?? createVenueHttpClient();
  }

  /**
   * Positions for `address` — the primary ingestion source (chalk/category priors + size
   * bucketing, §12.4). An address the API has never seen is expected to 404 or return an empty
   * list; both resolve to `[]`, never an error (a fresh/never-traded wallet is a normal,
   * successful link, just with zero imported history).
   */
  async getPositions(address: string): Promise<PolymarketPosition[]> {
    try {
      const body = await this.http.get<unknown>(`${this.base}/positions`, {
        searchParams: { user: address },
      });
      return polymarketPositionsResponseSchema.parse(body);
    } catch (err) {
      if (err instanceof VenueHttpError && err.status === 404) return [];
      throw err;
    }
  }

  /**
   * Trade/activity history for `address` — used ONLY as a best-effort `first_seen` source
   * (§12.4: "trade timing → timing prior; best-effort, null if unavailable"). Unlike
   * `getPositions`, this NEVER throws: any failure at all (network, non-2xx, malformed body)
   * degrades to `[]` so an outage on this secondary call can never fail the whole ingestion job.
   */
  async getActivity(address: string): Promise<PolymarketActivity[]> {
    try {
      const body = await this.http.get<unknown>(`${this.base}/activity`, {
        searchParams: { user: address },
      });
      return polymarketActivityResponseSchema.parse(body);
    } catch {
      return [];
    }
  }
}
