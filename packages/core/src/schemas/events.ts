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
    /**
     * Pre-ghost spectator client UUID; strict UUID format or ignored (§5.6, §9.2). Typed as
     * a plain string here (not `.uuid()`) — this is a fire-and-forget endpoint, so a
     * malformed anon_id must be silently ignored by the handler, not reject the whole
     * request the way a hard schema constraint on a top-level field would (contract-change,
     * WS13-T1: see the handler's own UUID check for where "ignored" is actually enforced).
     */
    anon_id: z.string().max(64).optional(),
  })
  .strict();

export const eventIngestRequestSchema = z.object({ body: eventIngestBodySchema });

/** 202-style acknowledgement; ingestion is best-effort. */
export const eventIngestResponseSchema = z.object({ accepted: z.literal(true) });
