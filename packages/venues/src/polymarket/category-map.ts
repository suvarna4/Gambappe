/**
 * Polymarket Gamma category → our `MarketCategory` mapping table (§7.4). Default `other`.
 */
import type { MarketCategory } from '@receipts/core';

const POLYMARKET_CATEGORY_MAP: Record<string, MarketCategory> = {
  politics: 'politics',
  elections: 'politics',
  geopolitics: 'politics',
  economy: 'economics',
  economics: 'economics',
  business: 'economics',
  crypto: 'economics',
  finance: 'economics',
  sports: 'sports',
  culture: 'culture',
  entertainment: 'culture',
  'pop culture': 'culture',
  science: 'science',
  technology: 'science',
  'science and technology': 'science',
  ai: 'science',
  climate: 'science',
};

export function mapPolymarketCategory(raw: string | null | undefined): MarketCategory {
  if (!raw) return 'other';
  return POLYMARKET_CATEGORY_MAP[raw.trim().toLowerCase()] ?? 'other';
}
