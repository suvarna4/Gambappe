/**
 * Nemesis bonus question selection + authoring (design doc §8.8, §8.8.1, WS5-T1). Selects up to
 * a few `nemesis_eligible` markets from the pair's top overlapping categories, authoring a
 * `nemesis_bonus` question for each (or reusing an already-`open` one for the same market, per
 * §8.8.1's dedup rule) — "a 0-bonus week is valid" if nothing fits.
 *
 * SPEC-GAP(ws5-t1): §8.8 says "the pairing's 2–3 nemesis_bonus questions" but Appendix D has no
 * `NEMESIS_BONUS_*` constant pinning an exact count/range, and this task's spec sections don't
 * name one either. Using 3 as the max-attempt count (0..3 actual, degrading gracefully with
 * however many eligible candidates exist — "skip bonus if none fit" is explicitly valid) rather
 * than inventing a stricter minimum. WS5-T2 (§19.3: "Bonus question selection", depends on this
 * task) owns the deeper AC here ("category-overlap-driven selection test") — this is a
 * best-effort implementation so `nemesis:assign` produces a complete, spec-shaped pairing today,
 * not a claim on WS5-T2's own AC.
 */
import { uuidv7 } from 'uuidv7';
import type { MarketCategory } from '@receipts/core';
import { SCHEDULE_TZ, slugifyHandle } from '@receipts/core';
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

const ALL_CATEGORIES: readonly MarketCategory[] = ['sports', 'politics', 'economics', 'culture', 'science', 'other'];

/** Categories ordered by `min(shareA[c], shareB[c])` descending (§8.2 `categoryOverlap` per
 * category) — "the pair's top overlapping categories" (§8.8). */
export function rankOverlappingCategories(
  categories: readonly MarketCategory[],
  sharesA: Partial<Record<MarketCategory, number>>,
  sharesB: Partial<Record<MarketCategory, number>>,
): MarketCategory[] {
  return [...categories].sort((a, b) => {
    const overlapA = Math.min(sharesA[a] ?? 0, sharesB[a] ?? 0);
    const overlapB = Math.min(sharesA[b] ?? 0, sharesB[b] ?? 0);
    return overlapB - overlapA;
  });
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
 * this pairing's week, from the pair's top overlapping categories. Never throws on a
 * market/authoring hiccup for one candidate — best-effort, "0-bonus is valid" (§8.8).
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

  const rankedCategories = rankOverlappingCategories(ALL_CATEGORIES, input.sharesA, input.sharesB);

  const selected: QuestionRow[] = [];
  const usedMarketIds = new Set<string>();

  for (const category of rankedCategories) {
    if (selected.length >= MAX_BONUS_QUESTIONS) break;

    let candidates: Awaited<ReturnType<typeof listNemesisEligibleMarketsForCategory>>;
    try {
      candidates = await listNemesisEligibleMarketsForCategory(db, category, weekStartUtc, weekEndUtc, CANDIDATES_PER_CATEGORY);
    } catch (err) {
      logger.warn({ err, category }, 'nemesis bonus: candidate market query failed for category — skipping');
      continue;
    }

    for (const market of candidates) {
      if (selected.length >= MAX_BONUS_QUESTIONS) break;
      if (usedMarketIds.has(market.id)) continue;

      try {
        const question = await authorOrReuseBonusQuestion(db, input.weekStart, sundayNoonEtUtc, openAt, market);
        if (question) {
          selected.push(question);
          usedMarketIds.add(market.id);
        }
      } catch (err) {
        // Best-effort (§8.8: "0-bonus week is valid") — one bad market must not abort the run.
        logger.warn({ err, marketId: market.id }, 'nemesis bonus: authoring failed for market — skipping');
      }
    }
  }

  return selected;
}
