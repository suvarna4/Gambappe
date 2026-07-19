#!/usr/bin/env node
/**
 * Question Zero drill, step 5 (optional, for the worker-kill-at-lock recovery exercise):
 * seeds one `market_price_snapshots` row at `lock_at`, so a late `question:lock` fire
 * (§5.7 — "a late lock job back-fills the lock snapshot ... from the price snapshot nearest
 * lock_at") has a concrete, distinct value to prove it actually reads, distinguishable from
 * both the market's original price and whatever price you inject into Redis during the
 * simulated outage.
 *
 * Usage:
 *   node scripts/question-zero-drill/seed-lock-snapshot.mjs <marketId> <lockAtIso> <price>
 */
import { connect, insertPriceSnapshot } from '@receipts/db';

const [marketId, lockAtIso, priceStr] = process.argv.slice(2);
if (!marketId || !lockAtIso || !priceStr) {
  console.error('usage: node seed-lock-snapshot.mjs <marketId> <lockAtIso> <price>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — point it at your disposable drill database first.');
  process.exit(1);
}

async function main() {
  const { pool, db } = connect();
  await insertPriceSnapshot(db, marketId, new Date(lockAtIso), Number(priceStr));
  console.log('seeded price snapshot', { marketId, lockAtIso, price: Number(priceStr) });
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
