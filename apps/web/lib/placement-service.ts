/**
 * Placement flow service (design doc §8.7, §5.5, §9.2 `GET /placement` / `POST
 * /placement/answers`, WS4-T8). Two independent pieces live here:
 *
 *  1. Pure logic — stratified sampling and the prior-axis formula — kept dependency-free so
 *     it's directly unit-testable (no DB, no clock reads; `Date`/rng are parameters).
 *  2. Thin `@receipts/db`-backed helpers the route handlers call. `placement_items` and
 *     `placement_answers` have no dedicated `packages/db/src/repositories/*` file (WS4-T8's
 *     scope is additive-only under `packages/db/src/testing/`, not `repositories/`), so the
 *     handful of queries needed live here instead.
 */
import { eq } from 'drizzle-orm';
import type { FingerprintPrior, MarketCategory, MarketSide } from '@receipts/core';
import { fingerprints, placementAnswers, placementItems, type Db } from '@receipts/db';

export type PlacementItemRow = typeof placementItems.$inferSelect;
export type PlacementAnswerRow = typeof placementAnswers.$inferSelect;

// --- Pure: stratified sampling (§8.7 "5 items ... stratified: ≥3 categories") -----------------

/** Fisher–Yates, parameterized on `rng` so tests can assert distribution without flakiness. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

/**
 * Samples `count` items from `pool`, guaranteeing coverage of at least
 * `min(minCategories, distinct categories present, count)` distinct categories when the pool
 * allows it. Algorithm: shuffle the category list, take one random item from each of the first
 * `minCategories` categories (coverage), then fill remaining slots randomly from what's left,
 * then shuffle the final selection so category-guaranteed slots aren't always first. Pure/rng-
 * injected so the "not always the same 3 categories" AC is testable deterministically.
 */
export function stratifiedSample<T extends { category: string }>(
  pool: readonly T[],
  count: number,
  minCategories: number,
  rng: () => number = Math.random,
): T[] {
  if (pool.length <= count) return shuffle(pool, rng);

  const byCategory = new Map<string, T[]>();
  for (const item of pool) {
    const list = byCategory.get(item.category);
    if (list) list.push(item);
    else byCategory.set(item.category, [item]);
  }

  const categories = shuffle([...byCategory.keys()], rng);
  const coverageTarget = Math.min(minCategories, categories.length, count);

  const selected: T[] = [];
  const chosen = new Set<T>();
  for (const category of categories.slice(0, coverageTarget)) {
    const options = byCategory.get(category);
    if (!options || options.length === 0) continue;
    const pick = shuffle(options, rng)[0];
    if (!pick) continue;
    selected.push(pick);
    chosen.add(pick);
  }

  const remaining = shuffle(
    pool.filter((item) => !chosen.has(item)),
    rng,
  );
  for (const item of remaining) {
    if (selected.length >= count) break;
    selected.push(item);
  }

  return shuffle(selected, rng);
}

/** §8.7: 5 items, ≥3 distinct categories among them. */
export function samplePlacementItems<T extends { category: string }>(
  pool: readonly T[],
  rng: () => number = Math.random,
): T[] {
  return stratifiedSample(pool, 5, 3, rng);
}

// --- Pure: placement prior (§8.7, §8.1 "n=5, no shrinkage") -----------------------------------

export interface PlacementAnswerForPrior {
  side: MarketSide;
  /** `placement_items.historical_yes_price`, in [0,1]. */
  historicalYesPrice: number;
  /** `placement_items.historical_crowd_yes_pct`, in [0,100]. */
  historicalCrowdYesPct: number;
}

/**
 * §8.7: "chalk and contrarian computed from the [n] answers against historical price/crowd
 * data with the §8.1 formulas (n=5, no shrinkage — the PRIOR_WEIGHT blend handles moderation)."
 * Unlike the nightly fingerprint rebuild (`packages/engine/src/fingerprint.ts`), this is never
 * shrunk — shrinkage and the prior blend are two different moderation mechanisms (§8.1), and
 * placement explicitly opts out of the former. Timing is never included (`placement_items` have
 * no open/lock window, §8.7) — callers must not set a `timing` key on the returned prior.
 *
 * SPEC-GAP(WS4-T8): §8.1's raw contrarian formula restricts to picks where lock-crowd n ≥
 * CROWD_MIN_N (a raw vote count). `placement_items` stores only a crowd *percentage*
 * (`historical_crowd_yes_pct`), not a count, so that eligibility gate has no equivalent input
 * here. Curated placement content is assumed to always represent a liquid-enough historical
 * market to be "eligible" — every answer counts toward the contrarian denominator.
 */
export function computePlacementPriorAxes(
  answers: readonly PlacementAnswerForPrior[],
): { chalk: number; contrarian: number } | null {
  const n = answers.length;
  if (n === 0) return null;

  let pSum = 0;
  let minorityCount = 0;
  for (const answer of answers) {
    const p =
      answer.side === 'yes' ? answer.historicalYesPrice : 1 - answer.historicalYesPrice;
    pSum += p;

    const crowdYesShare = answer.historicalCrowdYesPct / 100;
    const chosenShare = answer.side === 'yes' ? crowdYesShare : 1 - crowdYesShare;
    if (chosenShare < 0.5) minorityCount += 1;
  }

  return {
    chalk: 2 * (pSum / n) - 1,
    contrarian: 2 * (minorityCount / n) - 1,
  };
}

// --- DB-backed helpers ---------------------------------------------------------------------

export async function getActivePlacementItems(db: Db): Promise<PlacementItemRow[]> {
  return db.select().from(placementItems).where(eq(placementItems.active, true));
}

export async function getPlacementItemById(
  db: Db,
  id: string,
): Promise<PlacementItemRow | null> {
  const [row] = await db
    .select()
    .from(placementItems)
    .where(eq(placementItems.id, id))
    .limit(1);
  return row ?? null;
}

/** No outcomes (§9.2) — the wire shape `GET /placement` actually serves. */
export function toPublicPlacementItem(item: PlacementItemRow): {
  id: string;
  title: string;
  category: MarketCategory;
  yes_label: string;
  no_label: string;
} {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    yes_label: item.yesLabel,
    no_label: item.noLabel,
  };
}

/**
 * Upserts a `placement_answers` row (PK `(profile_id, placement_item_id)`, §5.5). SPEC-GAP
 * (WS4-T8): the doc doesn't define duplicate-answer semantics for the same item; there's no
 * undo concept for placement (unlike picks, §6.2). We treat a repeat POST for the same item as
 * "last answer wins" (upsert) rather than erroring — simplest behavior consistent with the
 * invariants, and forgiving of client retries/double-taps.
 */
export async function upsertPlacementAnswer(
  db: Db,
  profileId: string,
  itemId: string,
  side: MarketSide,
  answeredAt: Date,
): Promise<PlacementAnswerRow> {
  const [row] = await db
    .insert(placementAnswers)
    .values({ profileId, placementItemId: itemId, side, answeredAt })
    .onConflictDoUpdate({
      target: [placementAnswers.profileId, placementAnswers.placementItemId],
      set: { side, answeredAt },
    })
    .returning();
  if (!row) throw new Error('upsertPlacementAnswer: no row returned');
  return row;
}

async function getPlacementAnswersForPrior(
  db: Db,
  profileId: string,
): Promise<PlacementAnswerForPrior[]> {
  return db
    .select({
      side: placementAnswers.side,
      historicalYesPrice: placementItems.historicalYesPrice,
      historicalCrowdYesPct: placementItems.historicalCrowdYesPct,
    })
    .from(placementAnswers)
    .innerJoin(placementItems, eq(placementAnswers.placementItemId, placementItems.id))
    .where(eq(placementAnswers.profileId, profileId));
}

/**
 * Recomputes the profile's placement prior from ALL of its `placement_answers` so far (not
 * gated on reaching exactly 5 — §8.7/WS4-T8: "the doc doesn't gate a minimum") and upserts it
 * onto `fingerprints.placement_prior`, creating the `fingerprints` row if the nightly rebuild
 * (WS4-T7) hasn't run for this profile yet. Only the `placement_prior` column is touched on
 * conflict — every other fingerprint column (rating lives in a separate `ratings` table
 * entirely, §5.4) is left exactly as the nightly job last wrote it, per §8.7 "rating untouched
 * (stays 1500/350)". Wallet import (§12, WS12) averaging with an existing prior is that
 * workstream's concern, not implemented here.
 */
export async function seedPlacementPrior(db: Db, profileId: string, at: Date): Promise<void> {
  const answers = await getPlacementAnswersForPrior(db, profileId);
  const axes = computePlacementPriorAxes(answers);
  if (!axes) return;

  const prior: FingerprintPrior = { chalk: axes.chalk, contrarian: axes.contrarian };

  await db
    .insert(fingerprints)
    .values({
      profileId,
      resolvedPickCount: 0,
      computedAt: at,
      placementPrior: prior,
    })
    .onConflictDoUpdate({
      target: fingerprints.profileId,
      set: { placementPrior: prior },
    });
}

/** The per-item mini reveal-loop result (§8.7, `placementAnswerResponseSchema`). */
export function buildPlacementAnswerResult(
  item: PlacementItemRow,
  side: MarketSide,
): {
  item_id: string;
  side: MarketSide;
  outcome: MarketSide;
  correct: boolean;
  historical_yes_price: number;
  historical_crowd_yes_pct: number;
  resolved_on: string;
} {
  return {
    item_id: item.id,
    side,
    outcome: item.outcome,
    correct: side === item.outcome,
    historical_yes_price: item.historicalYesPrice,
    historical_crowd_yes_pct: item.historicalCrowdYesPct,
    resolved_on: item.resolvedOn,
  };
}

/** Best-effort client IP for the ghost-mint rate limiter (§6.1.1) — no `NextRequest.ip` at MVP. */
export function clientIpFromRequest(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
