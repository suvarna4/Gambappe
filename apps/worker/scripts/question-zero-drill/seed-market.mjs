#!/usr/bin/env node
/**
 * Question Zero drill, step 1: seed a `markets` row the way `venue:sync-catalog` would have.
 * The composer (§15.2) only ever reads from `markets` — it never calls a venue live — so a
 * hand-seeded row is a faithful stand-in for "venue sync already ran" without needing real
 * Kalshi/Polymarket credentials.
 *
 * Usage (from repo root, with the drill's env sourced — see docs/runbooks/launch-drill.md):
 *   node scripts/question-zero-drill/seed-market.mjs [venueMarketId]
 *
 * Requires DATABASE_URL and the workspace packages built (`pnpm --filter @receipts/db build`).
 */
import { connect, insertMarket } from '@receipts/db';
import { uuidv7 } from 'uuidv7';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — point it at your disposable drill database first.');
  process.exit(1);
}

const venueMarketId = process.argv[2] ?? `DRILL-${Date.now()}`;

async function main() {
  const { pool, db } = connect();
  const now = new Date();
  const closeTime = new Date(now.getTime() + 6 * 3600_000);
  const market = await insertMarket(db, {
    id: uuidv7(),
    venue: 'kalshi',
    venueMarketId,
    title: 'Question Zero drill market',
    category: 'other',
    closeTime,
    expectedResolveTime: new Date(closeTime.getTime() + 3600_000),
    status: 'open',
    yesPrice: 0.55,
    yesPriceUpdatedAt: now,
    venueUrl: `https://kalshi.example/markets/${venueMarketId.toLowerCase()}`,
    nemesisEligible: false,
    raw: { drill: true },
  });
  console.log(`seeded market ${market.id} (venueMarketId=${market.venueMarketId})`);
  console.log('pass this id as market_id to curate.sh');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
