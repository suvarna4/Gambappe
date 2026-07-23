/**
 * xTrace wire shapes (Appendix A, pinned 2026-07-23). Only the fields we read — every schema
 * is `passthrough` so unmodeled server fields never fail parsing.
 */
import { z } from 'zod';

export const xtraceMemorySchema = z
  .object({
    id: z.string(),
    type: z.string(),
    text: z.string(),
    user_id: z.string().nullable().optional(),
    group_ids: z.array(z.string()).nullable().optional(),
    score: z.number().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough();
export type XtraceMemoryWire = z.infer<typeof xtraceMemorySchema>;

export const xtraceSearchResponseSchema = z
  .object({
    data: z.array(xtraceMemorySchema),
  })
  .passthrough();
export type XtraceSearchResponse = z.infer<typeof xtraceSearchResponseSchema>;

export const xtraceIngestAcceptedSchema = z
  .object({
    id: z.string(),
    status: z.string(),
  })
  .passthrough();
export type XtraceIngestAccepted = z.infer<typeof xtraceIngestAcceptedSchema>;
