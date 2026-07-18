/**
 * Nemesis bonus question selection + authoring (design doc §8.8, §8.8.1, WS5-T1/WS5-T2). Selects
 * up to a few `nemesis_eligible` markets from the pair's top overlapping categories, authoring a
 * `nemesis_bonus` question for each (or reusing an already-`open` one for the same market, per
 * §8.8.1's dedup rule) — "a 0-bonus week is valid" if nothing fits.
 *
 * WS5-T2 note: the category-overlap-driven selection is split into two pieces so it's
 * independently, deterministically testable (mirrors WS4-T4's pure `matchNemeses` pattern):
 *   1. `rankOverlappingCategories` + `hasCategoryOverlap` — pure, no I/O. §8.8 says bonus markets
 *      come "from the pair's top overlapping categories"; a category where one member has a 0%
 *      share isn't "overlapping" at all, so `selectNemesisBonusQuestions` below only ever queries
 *      candidates for categories with a genuine (>0) overlap — a pair with zero shared category
 *      interest gets a 0-bonus week even if `nemesis_eligible` markets exist in categories
 *      neither of them touches. SPEC-GAP(ws5-t2): §8.8's prose doesn't spell out this "zero
 *      overlap → excluded, not just deprioritized" edge explicitly; it's the plain reading of
 *      "top overlapping categories" and keeps "0-bonus is valid" meaningful rather than a rare
 *      accident of an empty DB.
 *   2. `selectBonusMarketCandidates` — pure, no I/O. Given already-ranked/filtered categories and
 *      each one's already-fetched DB candidates, picks up to `MAX_BONUS_QUESTIONS` markets in
 *      ranked-category order, deduplicating by market id. This is the function the WS5-T2
 *      "category-overlap-driven selection test" AC exercises directly.
 *
 * SPEC-GAP(ws5-t1, still open): §8.8 says "the pairing's 2–3 nemesis_bonus questions" but
 * Appendix D has no `NEMESIS_BONUS_*` constant pinning an exact count/range. Using 3 as the
 * max-attempt count (0..3 actual, degrading gracefully with however many eligible candidates
 * exist — "skip bonus if none fit" is explicitly valid) rather than inventing a stricter minimum.
 */
import { uuidv7 } from 'uuidv7';
import type { MarketCategory } from '@receipts/core';
import { MARKET_CATEGORY, SCHEDULE_TZ, slugifyHandle } from '@receipts/core';
import {
  findOpenNemesisBonusQuestionForMarket,
  getQuestionById,
  insertQuestion,
  listNemesisEligibleMarketsForCategory,
  type Db,
  type QuestionRow,
} from '@receipts/db';
import { addDaysToDateStr, zonedLocalTimeToUtc } from './day-window.js';
import { logger } from '../logger.js';

/** §8.8: "2–3 nemesis_bonus questions" — no pinned Appendix D constant (see file header). */
const MAX_BONUS_QUESTIONS = 3;
/** Markets considered per category before moving to the next-best-overlap category. */
const CANDIDATES_PER_CATEGORY = MAX_BONUS_QUESTIONS;

/** `min(shareA[c], shareB[c])` (§8.2 `categoryOverlap`'s per-category term) — 0 means the pair
 * doesn't genuinely share this category at all. */
function categoryOverlapValue(
  category: MarketCategory,
  sharesA: Partial<Record<MarketCategory, number>>,
  sharesB: Partial<Record<MarketCategory, number>>,
): number {
  return Math.min(sharesA[category] ?? 0, sharesB[category] ?? 0);
}

/** Categories ordered by `min(shareA[c], shareB[c])` descending (§8.2 `categoryOverlap` per
 * category) — "the pair's top overlapping categories" (§8.8). Returns every input category
 * (including zero-overlap ones) in ranked order; callers that want only genuinely overlapping
 * categories should also filter with `hasCategoryOverlap`. */
export function rankOverlappingCategories(
  categories: readonly MarketCategory[],
  sharesA: Partial<Record<MarketCategory, number>>,
  sharesB: Partial<Record<MarketCategory, number>>,
): MarketCategory[] {
  return [...categories].sort(
    (a, b) => categoryOverlapValue(b, sharesA, sharesB) - categoryOverlapValue(a, sharesA, sharesB),
  );
}

/** True iff the pair has a genuine (>0) overlap in this category — see file header SPEC-GAP. */
export function hasCategoryOverlap(
  category: MarketCategory,
  sharesA: Partial<Record<MarketCategory, number>>,
  sharesB: Partial<Record<MarketCategory, number>>,
): boolean {
  return categoryOverlapValue(category, sharesA, sharesB) > 0;
}

/**
 * Pure selection core (§8.8, WS5-T2 AC): walks `rankedCategories` in order, picking candidates
 * from `candidatesByCategory` up to `maxCount`, deduplicating by id. No I/O — `rankedCategories`
 * and `candidatesByCategory` are expected to already be filtered/fetched by the caller. This is
 * what actually determines "category-overlap-driven selection": candidates in a higher-ranked
 * category are always exhausted before a lower-ranked category is considered.
 */
export function selectBonusMarketCandidates<T extends { id: string }>(
  rankedCategories: readonly MarketCategory[],
  candidatesByCategory: ReadonlyMap<MarketCategory, readonly T[]>,
  maxCount: number,
): T[] {
  const selected: T[] = [];
  const usedIds = new Set<string>();
  for (const category of rankedCategories) {
    if (selected.length >= maxCount) break;
    for (const candidate of candidatesByCategory.get(category) ?? []) {
      if (selected.length >= maxCount) break;
      if (usedIds.has(candidate.id)) continue;
      selected.push(candidate);
      usedIds.add(candidate.id);
    }
  }
  return selected;
}

/** e.g. `nemesis-2026-07-20-will-the-fed-cut-rates-<shortid>` — a market may be picked as a
 * bonus for many pairings across many weeks, so the slug needs a disambiguator beyond the
 * headline+week (unlike `curation.ts`'s daily `buildQuestionSlug`, which has one daily/date). */
function buildBonusQuestionSlug(weekStart: string, title: string, disambiguator: string): string {
  return `nemesis-${weekStart}-${slugifyHandle(title)}-${disambiguator.slice(0, 8)}`;
}

async function authorOrReuseBonusQuestion(
  db: Db,
  weekStart: string,
  sundayNoonEtUtc: Date,
  openAt: Date,
  market: { id: string; title: string; closeTime: Date },
): Promise<QuestionRow | null> {
  const existing = await findOpenNemesisBonusQuestionForMarket(db, market.id);
  if (existing) {
    return getQuestionById(db, existing.id);
  }

  const id = uuidv7();
  const lockAt = market.closeTime.getTime() < sundayNoonEtUtc.getTime() ? market.closeTime : sundayNoonEtUtc;
  return insertQuestion(db, {
    id,
    kind: 'nemesis_bonus',
    marketId: market.id,
    questionDate: null,
    slug: buildBonusQuestionSlug(weekStart, market.title, id),
    headline: market.title,
    yesLabel: 'Yes',
    noLabel: 'No',
    openAt,
    lockAt,
    // §8.8.1: "reveal_at = lock_at — bonus questions have no held reveal".
    revealAt: lockAt,
    status: 'open',
  });
}

/**
 * Authors (or reuses, §8.8.1 dedup) up to `MAX_BONUS_QUESTIONS` `nemesis_bonus` questions for
 * this pairing's week, from the pair's top *genuinely overlapping* categories (see file header
 * SPEC-GAP(ws5-t2)). Never throws on a market/authoring hiccup for one candidate — best-effort,
 * "0-bonus is valid" (§8.8) — and returns `[]` outright when the pair shares no category at all.
 */
export async function selectNemesisBonusQuestions(
  db: Db,
  input: {
    weekStart: string;
    sharesA: Partial<Record<MarketCategory, number>>;
    sharesB: Partial<Record<MarketCategory, number>>;
  },
): Promise<QuestionRow[]> {
  const weekStartUtc = zonedLocalTimeToUtc(input.weekStart, 0, 0, SCHEDULE_TZ);
  const weekEndUtc = zonedLocalTimeToUtc(addDaysToDateStr(input.weekStart, 7), 0, 0, SCHEDULE_TZ);
  // §8.8.1: lock_at = min(market.close_time, Sunday 12:00 ET of the nemesis week).
  const sundayNoonEtUtc = zonedLocalTimeToUtc(addDaysToDateStr(input.weekStart, 6), 12, 0, SCHEDULE_TZ);
  const openAt = new Date();

  const rankedCategories = rankOverlappingCategories(MARKET_CATEGORY, input.sharesA, input.sharesB).filter((c) =>
    hasCategoryOverlap(c, input.sharesA, input.sharesB),
  );

  // Fetch each overlapping category's candidates (best-effort per category — one bad query must
  // not abort the others) before handing off to the pure selection core.
  const candidatesByCategory = new Map<MarketCategory, Awaited<ReturnType<typeof listNemesisEligibleMarketsForCategory>>>();
  for (const category of rankedCategories) {
    try {
      const candidates = await listNemesisEligibleMarketsForCategory(db, category, weekStartUtc, weekEndUtc, CANDIDATES_PER_CATEGORY);
      candidatesByCategory.set(category, candidates);
    } catch (err) {
      logger.warn({ err, category }, 'nemesis bonus: candidate market query failed for category — skipping');
    }
  }

  const chosenMarkets = selectBonusMarketCandidates(rankedCategories, candidatesByCategory, MAX_BONUS_QUESTIONS);

  const selected: QuestionRow[] = [];
  for (const market of chosenMarkets) {
    try {
      const question = await authorOrReuseBonusQuestion(db, input.weekStart, sundayNoonEtUtc, openAt, market);
      if (question) selected.push(question);
    } catch (err) {
      // Best-effort (§8.8: "0-bonus week is valid") — one bad market must not abort the run.
      logger.warn({ err, marketId: market.id }, 'nemesis bonus: authoring failed for market — skipping');
    }
  }

  return selected;
}
