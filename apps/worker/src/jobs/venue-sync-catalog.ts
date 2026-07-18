/**
 * `venue:sync-catalog` (WS1-T4; §7.5 hourly): upsert candidate markets (both venues) into
 * `markets` for the curation pool. Markets referenced by existing questions but missing from
 * the current feed listing are kept, flagged `stale_in_feed` in `raw` (never deleted).
 */
import { now } from '@receipts/core';
import type { NormalizedMarket, VenueAdapter } from '@receipts/venues';
import { flagStaleMarkets, upsertMarket, type NewMarketRow } from '@receipts/db';
import { uuidv7 } from 'uuidv7';
import type { Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { defaultVenueAdapters } from '../venues.js';

/**
 * Curation-pool candidate window/floor. Appendix D doesn't pin these (they're a curator-tool
 * concern, §15.2, not a scoring constant) — SPEC-GAP(WS1-T4): conservative defaults chosen
 * here (2-week close window, $1k liquidity floor, 200 markets/venue/sync) pending a curation
 * task tightening them if needed.
 */
const SYNC_CLOSES_WITHIN_H: [number, number] = [0, 24 * 14];
const SYNC_MIN_LIQUIDITY_USD = 1_000;
const SYNC_LIST_LIMIT = 200;

function toNewMarketRow(market: NormalizedMarket, at: Date): NewMarketRow {
  return {
    id: uuidv7(),
    venue: market.venue,
    venueMarketId: market.venueMarketId,
    title: market.title,
    category: market.category,
    closeTime: market.closeTime,
    ...(market.expectedResolveTime ? { expectedResolveTime: market.expectedResolveTime } : {}),
    status: 'open',
    ...(market.yesPrice !== undefined
      ? { yesPrice: market.yesPrice, yesPriceUpdatedAt: at }
      : {}),
    ...(market.liquidityUsd !== undefined ? { liquidityUsd: market.liquidityUsd } : {}),
    venueUrl: market.venueUrl,
    raw: market.raw,
  };
}

export interface SyncCatalogVenueReport {
  venue: string;
  listed: number;
  upserted: number;
  staleFlagged: number;
  error?: string;
}

export async function runVenueSyncCatalog(
  db: Db,
  adapters: VenueAdapter[] = defaultVenueAdapters(),
  at: Date = now(),
): Promise<SyncCatalogVenueReport[]> {
  const reports: SyncCatalogVenueReport[] = [];

  for (const adapter of adapters) {
    try {
      const candidates = await adapter.listCandidateMarkets({
        closesWithinH: SYNC_CLOSES_WITHIN_H,
        minLiquidityUsd: SYNC_MIN_LIQUIDITY_USD,
        limit: SYNC_LIST_LIMIT,
      });

      const seen: string[] = [];
      for (const market of candidates) {
        await upsertMarket(db, toNewMarketRow(market, at));
        seen.push(market.venueMarketId);
      }
      const staleFlagged = await flagStaleMarkets(db, adapter.venue, seen, at);

      reports.push({
        venue: adapter.venue,
        listed: candidates.length,
        upserted: candidates.length,
        staleFlagged,
      });
    } catch (err) {
      logger.error({ err, venue: adapter.venue }, 'venue:sync-catalog failed for venue');
      reports.push({
        venue: adapter.venue,
        listed: 0,
        upserted: 0,
        staleFlagged: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return reports;
}

export const venueSyncCatalogHandler: JobHandler = async (ctx) => {
  const report = await runVenueSyncCatalog(ctx.db);
  logger.info({ report }, 'venue:sync-catalog complete');
  // One venue's outage never blocks the other's sync (isolates blast radius, R1), but the
  // job itself still needs to surface failure — heartbeat/pg-boss "fail fast, retry on
  // schedule" (§7.5) — rather than silently reporting success.
  const failed = report.filter((r) => r.error);
  if (failed.length > 0) {
    throw new Error(
      `venue:sync-catalog: ${failed.length} venue(s) failed: ${failed
        .map((r) => `${r.venue}: ${r.error}`)
        .join('; ')}`,
    );
  }
};
