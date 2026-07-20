/**
 * Kalshi VenueAdapter (§7.3). Catalog + market + price + resolution all read from the same
 * `/markets` / `/markets/{ticker}` endpoints (Kalshi trade API v2 shape, best-effort — see
 * fixtures/venue-notes.md SPEC-GAP on live verification).
 */
import { now, type CandidateMarketQuery, type NormalizedMarket, type VenuePriceQuote, type VenueResolution } from '@receipts/core';
import type { VenueAdapter } from '../adapter.js';
import { createVenueHttpClient, VenueHttpError, type VenueHttpClient } from '../http-client.js';
import { isBinaryKalshiMarket, kalshiActivityUsd, kalshiResolution, kalshiYesPrice, normalizeKalshiMarket } from './normalize.js';
import { kalshiMarketResponseSchema, kalshiMarketsResponseSchema, type KalshiMarket } from './schemas.js';

export interface KalshiAdapterOptions {
  /** Defaults to env `KALSHI_API_BASE` (Appendix B). */
  baseUrl?: string;
  http?: VenueHttpClient;
  rps?: number;
}

/**
 * WS15-T1, tuned against the live feed:
 * - The raw `/markets` listing is ~96% auto-generated multi-game combo markets (`KXMVE…`
 *   tickers, binary `market_type`, near-zero open interest). The activity floor drops that
 *   noise — no ticker heuristics — but it takes a deep scan to surface the real markets,
 *   hence the generous total page budget (30 requests ≈ 8s at the default 4 rps, hourly).
 * - The listing arrives ordered from the FAR edge of the close window, so a single
 *   whole-window query fills the candidate limit with markets closing in two weeks and
 *   starves the same-day markets curation actually wants (§15.2). The window is therefore
 *   walked in ascending 24h buckets via server-side `min_close_ts`/`max_close_ts`
 *   (live-verified honored) — soonest-closing markets always claim the limit first.
 */
const MAX_LIST_PAGES = 30;
const LIST_PAGE_SIZE = 200;
const LIST_BUCKET_H = 24;

function resolveBaseUrl(explicit?: string): string {
  const base = explicit ?? process.env['KALSHI_API_BASE'];
  if (!base) throw new Error('KalshiAdapter: KALSHI_API_BASE is not set (see .env.example)');
  return base.replace(/\/$/, '');
}

export class KalshiAdapter implements VenueAdapter {
  readonly venue = 'kalshi' as const;
  private readonly baseUrl: string;
  private readonly http: VenueHttpClient;

  constructor(options: KalshiAdapterOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.http = options.http ?? createVenueHttpClient({ rps: options.rps });
  }

  async listCandidateMarkets(q: CandidateMarketQuery): Promise<NormalizedMarket[]> {
    const t = now().getTime();
    const [minH, maxH] = q.closesWithinH;
    const results: NormalizedMarket[] = [];
    let pagesUsed = 0;

    // Ascending 24h close-time buckets — see the MAX_LIST_PAGES comment for why.
    for (let bucketStartH = minH; bucketStartH < maxH; bucketStartH += LIST_BUCKET_H) {
      const bucketEndH = Math.min(bucketStartH + LIST_BUCKET_H, maxH);
      let cursor: string | undefined;

      do {
        if (pagesUsed >= MAX_LIST_PAGES) return results;
        pagesUsed += 1;
        const body = await this.http.get<unknown>(`${this.baseUrl}/markets`, {
          searchParams: {
            status: 'open',
            limit: LIST_PAGE_SIZE,
            cursor,
            min_close_ts: Math.floor(t / 1000) + Math.ceil(bucketStartH * 3600),
            max_close_ts: Math.floor(t / 1000) + Math.floor(bucketEndH * 3600),
          },
        });
        const parsed = kalshiMarketsResponseSchema.parse(body);

        for (const raw of parsed.markets) {
          if (!isBinaryKalshiMarket(raw)) continue; // DD-7
          // Floor on order-book liquidity OR open-interest notional — the public feed
          // zeroes `liquidity_dollars` even on actively-traded markets (kalshiActivityUsd).
          if (kalshiActivityUsd(raw) < q.minLiquidityUsd) continue;
          const market = normalizeKalshiMarket(raw);
          const closesInH = (market.closeTime.getTime() - t) / 3600_000;
          // Re-check against THIS bucket (not just the overall window): the server-side
          // narrowing is defense-in-depth, and per-bucket bounds keep a market from being
          // collected twice should the server ever ignore the ts params.
          if (closesInH < bucketStartH) continue;
          if (bucketEndH === maxH ? closesInH > maxH : closesInH >= bucketEndH) continue;
          results.push(market);
          if (results.length >= q.limit) return results;
        }

        cursor = parsed.cursor ?? undefined;
      } while (cursor);
    }
    return results;
  }

  private async fetchRaw(venueMarketId: string): Promise<KalshiMarket | null> {
    try {
      const body = await this.http.get<unknown>(
        `${this.baseUrl}/markets/${encodeURIComponent(venueMarketId)}`,
      );
      return kalshiMarketResponseSchema.parse(body).market;
    } catch (err) {
      if (err instanceof VenueHttpError && err.status === 404) return null;
      throw err;
    }
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const raw = await this.fetchRaw(venueMarketId);
    if (!raw || !isBinaryKalshiMarket(raw)) return null;
    return normalizeKalshiMarket(raw);
  }

  async getYesPrice(venueMarketId: string): Promise<VenuePriceQuote | null> {
    const raw = await this.fetchRaw(venueMarketId);
    if (!raw || !isBinaryKalshiMarket(raw)) return null;
    const yesPrice = kalshiYesPrice(raw);
    if (yesPrice === undefined) return null;
    // Kalshi's market payload carries no per-quote timestamp field we've verified (SPEC-GAP,
    // fixtures/venue-notes.md); the fetch instant is the best available staleness anchor.
    return { yesPrice, ts: now() };
  }

  async getResolution(venueMarketId: string): Promise<VenueResolution> {
    const raw = await this.fetchRaw(venueMarketId);
    if (!raw) return { state: 'unresolved' }; // unknown id: ambiguous, never guess
    return kalshiResolution(raw);
  }
}
