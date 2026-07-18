/**
 * Analytics ingest schemas (design doc §13.1, §9.2 POST /events).
 * Fire-and-forget: unknown events and oversized props are DROPPED silently (not 400d) —
 * so `event` is a plain string here; the typed catalog is `ANALYTICS_EVENTS` (types/analytics).
 */
import { z } from 'zod';

export const eventIngestBodySchema = z
  .object({
    event: z.string().min(1).max(64),
    /** ≤ EVENT_PROPS_MAX_BYTES serialized (handler drops oversized, §13.1). */
    props: z.record(z.string(), z.unknown()).default({}),
    /** Pre-ghost spectator client UUID; strict UUID format or ignored (§5.6). */
    anon_id: z.string().uuid().optional(),
  })
  .strict();

export const eventIngestRequestSchema = z.object({ body: eventIngestBodySchema });

/** 202-style acknowledgement; ingestion is best-effort. */
export const eventIngestResponseSchema = z.object({ accepted: z.literal(true) });
