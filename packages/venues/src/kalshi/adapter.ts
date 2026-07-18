/**
 * Kalshi VenueAdapter (§7.3). Catalog + market + price + resolution all read from the same
 * `/markets` / `/markets/{ticker}` endpoints (Kalshi trade API v2 shape, best-effort — see
 * fixtures/venue-notes.md SPEC-GAP on live verification).
 */
import { now, type CandidateMarketQuery, type NormalizedMarket, type VenuePriceQuote, type VenueResolution } from '@receipts/core';
import type { VenueAdapter } from '../adapter.js';
import { createVenueHttpClient, VenueHttpError, type VenueHttpClient } from '../http-client.js';
import { isBinaryKalshiMarket, kalshiResolution, kalshiYesPrice, normalizeKalshiMarket } from './normalize.js';
import { kalshiMarketResponseSchema, kalshiMarketsResponseSchema, type KalshiMarket } from './schemas.js';

export interface KalshiAdapterOptions {
  /** Defaults to env `KALSHI_API_BASE` (Appendix B). */
  baseUrl?: string;
  http?: VenueHttpClient;
  rps?: number;
}

const MAX_LIST_PAGES = 5;
const LIST_PAGE_SIZE = 200;

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
    let cursor: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const body = await this.http.get<unknown>(`${this.baseUrl}/markets`, {
        searchParams: { status: 'open', limit: LIST_PAGE_SIZE, cursor },
      });
      const parsed = kalshiMarketsResponseSchema.parse(body);

      for (const raw of parsed.markets) {
        if (!isBinaryKalshiMarket(raw)) continue; // DD-7
        const market = normalizeKalshiMarket(raw);
        const closesInH = (market.closeTime.getTime() - t) / 3600_000;
        if (closesInH < minH || closesInH > maxH) continue;
        if ((market.liquidityUsd ?? 0) < q.minLiquidityUsd) continue;
        results.push(market);
        if (results.length >= q.limit) return results;
      }

      cursor = parsed.cursor ?? undefined;
      if (!cursor) break;
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
