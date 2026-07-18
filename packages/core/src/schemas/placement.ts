/**
 * Placement flow schemas (design doc §8.7, §9.2 GET /placement, POST /placement/answers).
 */
import { z } from 'zod';
import { MARKET_CATEGORY, MARKET_SIDE } from '../enums.js';
import { zPlacementItemId } from '../ids.js';
import { zDateOnly, zProbability } from './common.js';

/** A placement item as served (no outcomes — §9.2). */
export const placementItemSchema = z.object({
  id: zPlacementItemId,
  title: z.string(),
  category: z.enum(MARKET_CATEGORY),
  yes_label: z.string(),
  no_label: z.string(),
});

// --- GET /placement (ghost+): 5 items, stratified ≥3 categories (§8.7) ------------------------

export const getPlacementRequestSchema = z.object({});
export const getPlacementResponseSchema = z.object({
  items: z.array(placementItemSchema),
});

// --- POST /placement/answers: per-item result revealed in the response (§9.2) -----------------

export const placementAnswerBodySchema = z
  .object({
    item_id: zPlacementItemId,
    side: z.enum(MARKET_SIDE),
  })
  .strict();

export const placementAnswerRequestSchema = z.object({ body: placementAnswerBodySchema });

/** The mini reveal-loop tutorial payload: historical outcome + crowd comparison (§8.7). */
export const placementAnswerResponseSchema = z.object({
  item_id: zPlacementItemId,
  side: z.enum(MARKET_SIDE),
  outcome: z.enum(MARKET_SIDE),
  correct: z.boolean(),
  historical_yes_price: zProbability,
  historical_crowd_yes_pct: z.number().min(0).max(100),
  resolved_on: zDateOnly,
});
