/**
 * Polymarket VenueAdapter (§7.4). Catalog + resolution via the Gamma API; price via CLOB
 * midpoint for the YES token, falling back to Gamma `outcomePrices` (best-effort API shapes —
 * see fixtures/venue-notes.md SPEC-GAP on live verification). On-chain reads are NOT used at
 * MVP (§7.4).
 */
import {
  now,
  type CandidateMarketQuery,
  type NormalizedMarket,
  type VenuePriceQuote,
  type VenueResolution,
} from '@receipts/core';
import type { VenueAdapter } from '../adapter.js';
import { createVenueHttpClient, VenueHttpError, type VenueHttpClient } from '../http-client.js';
import {
  clampPrice,
  isBinaryPolymarketMarket,
  normalizeGammaMarket,
  polymarketGammaYesPrice,
  polymarketResolution,
  polymarketYesTokenId,
} from './normalize.js';
import {
  polymarketClobMidpointSchema,
  polymarketGammaMarketSchema,
  polymarketGammaMarketsResponseSchema,
  type PolymarketGammaMarket,
} from './schemas.js';

export interface PolymarketAdapterOptions {
  /** Defaults to env `POLYMARKET_GAMMA_BASE` (Appendix B). */
  gammaBaseUrl?: string;
  /** Defaults to env `POLYMARKET_CLOB_BASE` (Appendix B). */
  clobBaseUrl?: string;
  http?: VenueHttpClient;
  rps?: number;
}

const LIST_PAGE_SIZE = 500;

function resolveBase(explicit: string | undefined, envVar: string): string {
  const base = explicit ?? process.env[envVar];
  if (!base) throw new Error(`PolymarketAdapter: ${envVar} is not set (see .env.example)`);
  return base.replace(/\/$/, '');
}

export class PolymarketAdapter implements VenueAdapter {
  readonly venue = 'polymarket' as const;
  private readonly gammaBase: string;
  private readonly clobBase: string;
  private readonly http: VenueHttpClient;

  constructor(options: PolymarketAdapterOptions = {}) {
    this.gammaBase = resolveBase(options.gammaBaseUrl, 'POLYMARKET_GAMMA_BASE');
    this.clobBase = resolveBase(options.clobBaseUrl, 'POLYMARKET_CLOB_BASE');
    this.http = options.http ?? createVenueHttpClient({ rps: options.rps });
  }

  async listCandidateMarkets(q: CandidateMarketQuery): Promise<NormalizedMarket[]> {
    const t = now().getTime();
    const [minH, maxH] = q.closesWithinH;
    const results: NormalizedMarket[] = [];

    const body = await this.http.get<unknown>(`${this.gammaBase}/markets`, {
      searchParams: { active: 'true', closed: 'false', limit: LIST_PAGE_SIZE },
    });
    const markets = polymarketGammaMarketsResponseSchema.parse(body);

    for (const raw of markets) {
      if (raw.archived) continue;
      if (!isBinaryPolymarketMarket(raw)) continue; // DD-7
      const market = normalizeGammaMarket(raw);
      const closesInH = (market.closeTime.getTime() - t) / 3600_000;
      if (closesInH < minH || closesInH > maxH) continue;
      if ((market.liquidityUsd ?? 0) < q.minLiquidityUsd) continue;
      results.push(market);
      if (results.length >= q.limit) break;
    }
    return results;
  }

  private async fetchGammaMarket(venueMarketId: string): Promise<PolymarketGammaMarket | null> {
    try {
      const body = await this.http.get<unknown>(
        `${this.gammaBase}/markets/${encodeURIComponent(venueMarketId)}`,
      );
      // Gamma's single-market endpoint shape (bare object vs `{market: {...}}`) is unverified
      // live (SPEC-GAP, fixtures/venue-notes.md) — accept either.
      const candidate =
        body && typeof body === 'object' && 'market' in (body as Record<string, unknown>)
          ? (body as { market: unknown }).market
          : body;
      return polymarketGammaMarketSchema.parse(candidate);
    } catch (err) {
      if (err instanceof VenueHttpError && err.status === 404) return null;
      throw err;
    }
  }

  private async fetchClobMidpoint(market: PolymarketGammaMarket): Promise<number | undefined> {
    const tokenId = polymarketYesTokenId(market);
    if (!tokenId) return undefined;
    try {
      const body = await this.http.get<unknown>(`${this.clobBase}/midpoint`, {
        searchParams: { token_id: tokenId },
      });
      const parsed = polymarketClobMidpointSchema.parse(body);
      const mid = Number(parsed.mid);
      if (Number.isNaN(mid)) return undefined;
      return clampPrice(mid);
    } catch {
      return undefined; // CLOB unavailable — Gamma outcomePrices fallback (§7.4)
    }
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const raw = await this.fetchGammaMarket(venueMarketId);
    if (!raw || raw.archived || !isBinaryPolymarketMarket(raw)) return null;
    return normalizeGammaMarket(raw);
  }

  async getYesPrice(venueMarketId: string): Promise<VenuePriceQuote | null> {
    const raw = await this.fetchGammaMarket(venueMarketId);
    if (!raw || !isBinaryPolymarketMarket(raw)) return null;
    const clobPrice = await this.fetchClobMidpoint(raw);
    const yesPrice = clobPrice ?? polymarketGammaYesPrice(raw);
    if (yesPrice === undefined) return null;
    return { yesPrice, ts: now() };
  }

  async getResolution(venueMarketId: string): Promise<VenueResolution> {
    const raw = await this.fetchGammaMarket(venueMarketId);
    if (!raw) return { state: 'unresolved' }; // unknown id: ambiguous, never guess
    return polymarketResolution(raw);
  }
}
