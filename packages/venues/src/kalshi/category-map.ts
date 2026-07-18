/**
 * Kalshi category/series → our `MarketCategory` mapping table (§7.3). Default `other`;
 * curators can override per question. Kalshi's exact category vocabulary could not be
 * re-verified against live docs in this sandbox — see `fixtures/venue-notes.md` SPEC-GAP.
 */
import type { MarketCategory } from '@receipts/core';

const KALSHI_CATEGORY_MAP: Record<string, MarketCategory> = {
  politics: 'politics',
  elections: 'politics',
  government: 'politics',
  world: 'politics',
  economics: 'economics',
  economy: 'economics',
  financials: 'economics',
  markets: 'economics',
  sports: 'sports',
  entertainment: 'culture',
  culture: 'culture',
  media: 'culture',
  science: 'science',
  'science and technology': 'science',
  technology: 'science',
  climate: 'science',
  'climate and weather': 'science',
  weather: 'science',
  health: 'other',
};

export function mapKalshiCategory(raw: string | null | undefined): MarketCategory {
  if (!raw) return 'other';
  return KALSHI_CATEGORY_MAP[raw.trim().toLowerCase()] ?? 'other';
}
