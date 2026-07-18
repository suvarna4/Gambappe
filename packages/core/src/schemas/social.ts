/**
 * Blocks + reports schemas (design doc §9.2, §14.3, §5.6).
 */
import { z } from 'zod';
import { REPORT_CONTEXT, REPORT_REASON } from '../enums.js';
import { zProfileId, zReportId } from '../ids.js';

// --- POST /blocks (claimed) · DELETE /blocks/:blocked_profile_id ------------------------------
// Composite-key table, no surrogate id (§5.6) — delete addresses by blocked_profile_id (§9.2).

export const createBlockBodySchema = z
  .object({
    blocked_profile_id: zProfileId,
  })
  .strict();

export const createBlockRequestSchema = z.object({ body: createBlockBodySchema });
export const createBlockResponseSchema = z.object({ blocked: z.literal(true) });

export const deleteBlockRequestSchema = z.object({
  params: z.object({ blocked_profile_id: zProfileId }),
});
export const deleteBlockResponseSchema = z.object({ unblocked: z.literal(true) });

// --- POST /reports (ghost+; §14.3) ------------------------------------------------------------

export const createReportBodySchema = z
  .object({
    context_kind: z.enum(REPORT_CONTEXT),
    context_id: z.string().uuid(),
    reason: z.enum(REPORT_REASON),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const createReportRequestSchema = z.object({ body: createReportBodySchema });
export const createReportResponseSchema = z.object({
  report_id: zReportId,
  status: z.literal('open'),
});
