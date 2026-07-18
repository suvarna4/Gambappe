/**
 * Venue sync/price-tick repository helpers (WS1-T4; §7.5). `upsertMarket` keys off the
 * `markets_venue_market_uq` unique index (venue, venue_market_id) — the idempotent-catalog-
 * sync primitive `.onConflictDoUpdate` is built for.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { marketPriceSnapshots, markets } from '../schema/index.js';
import type { MarketRow, NewMarketRow } from './questions.js';

export async function upsertMarket(db: Db, row: NewMarketRow): Promise<MarketRow> {
  const [result] = await db
    .insert(markets)
    .values(row)
    .onConflictDoUpdate({
      target: [markets.venue, markets.venueMarketId],
      set: {
        title: row.title,
        category: row.category,
        closeTime: row.closeTime,
        expectedResolveTime: row.expectedResolveTime,
        status: row.status,
        yesPrice: row.yesPrice,
        yesPriceUpdatedAt: row.yesPriceUpdatedAt,
        liquidityUsd: row.liquidityUsd,
        venueUrl: row.venueUrl,
        raw: row.raw,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  if (!result) throw new Error('upsertMarket: no row returned');
  return result;
}

/** node-postgres/drizzle serialize JS arrays as JSON, not a PG array literal — build one by
 * hand (safe here: venue market ids are venue-controlled tickers/ids, not user input). */
function pgTextArrayLiteral(values: readonly string[]): string {
  const escaped = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${escaped.join(',')}}`;
}

/**
 * Markets referenced by existing questions but missing from the current sync's listing are
 * KEPT (never deleted) with `raw.stale_in_feed = true` merged in (§7.5). Markets that
 * reappear in a later sync naturally clear the flag — `upsertMarket` overwrites `raw`
 * wholesale with the fresh trimmed payload.
 */
export async function flagStaleMarkets(
  db: Db,
  venue: string,
  seenVenueMarketIds: readonly string[],
  at: Date,
): Promise<number> {
  const idArray = pgTextArrayLiteral(seenVenueMarketIds);
  const res = await db.execute(sql`
    UPDATE markets m
    SET raw = COALESCE(m.raw, '{}'::jsonb) || jsonb_build_object('stale_in_feed', true),
        updated_at = ${at.toISOString()}::timestamptz
    WHERE m.venue = ${venue}
      AND m.venue_market_id <> ALL(${idArray}::text[])
      AND EXISTS (SELECT 1 FROM questions q WHERE q.market_id = m.id)
  `);
  return res.rowCount ?? 0;
}

export interface PriceTickMarket {
  marketId: string;
  venue: string;
  venueMarketId: string;
  hasOpenQuestion: boolean;
  hasLockedQuestion: boolean;
}

/** Markets referenced by an `open` or `locked` question — the §7.5 `venue:price-tick` scope. */
export async function listMarketsForPriceTick(db: Db): Promise<PriceTickMarket[]> {
  const result = await db.execute(sql`
    SELECT m.id AS market_id, m.venue, m.venue_market_id,
           bool_or(q.status = 'open') AS has_open_question,
           bool_or(q.status = 'locked') AS has_locked_question
    FROM markets m
    JOIN questions q ON q.market_id = m.id
    WHERE q.status IN ('open', 'locked')
    GROUP BY m.id, m.venue, m.venue_market_id
    ORDER BY m.id
  `);
  return result.rows.map((r) => ({
    marketId: r['market_id'] as string,
    venue: r['venue'] as string,
    venueMarketId: r['venue_market_id'] as string,
    hasOpenQuestion: Boolean(r['has_open_question']),
    hasLockedQuestion: Boolean(r['has_locked_question']),
  }));
}

export async function updateMarketPrice(
  db: Db,
  marketId: string,
  yesPrice: number,
  ts: Date,
): Promise<void> {
  await db
    .update(markets)
    .set({ yesPrice, yesPriceUpdatedAt: ts, updatedAt: ts })
    .where(eq(markets.id, marketId));
}

export async function insertPriceSnapshot(
  db: Db,
  marketId: string,
  ts: Date,
  yesPrice: number,
): Promise<void> {
  await db.insert(marketPriceSnapshots).values({ marketId, ts, yesPrice });
}

/** Latest snapshot ts for a market, or null — drives the 5-min locked-question cadence (§7.5). */
export async function getLastSnapshotTs(db: Db, marketId: string): Promise<Date | null> {
  const [row] = await db
    .select({ ts: marketPriceSnapshots.ts })
    .from(marketPriceSnapshots)
    .where(eq(marketPriceSnapshots.marketId, marketId))
    .orderBy(desc(marketPriceSnapshots.ts))
    .limit(1);
  return row?.ts ?? null;
}
