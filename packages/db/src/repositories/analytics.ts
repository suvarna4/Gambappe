/**
 * Analytics event ingestion helper (§5.6, §13.1). WS3 scope is narrow: writing the `called_it`
 * badge event at reveal time (§6.7 — "Stored in `analytics_events` + derivable"). The general
 * `POST /events` ingest endpoint (client-origin events, prop-size limits, IP/UA hashing) is
 * WS13 scope; this is a direct server-side insert for a first-party event.
 */
import type { Db } from '../client.js';
import { analyticsEvents } from '../schema/index.js';

export interface AnalyticsEventInput {
  ts: Date;
  event: string;
  profileId?: string | null;
  isGhost?: boolean | null;
  props?: Record<string, unknown>;
}

export async function insertAnalyticsEvent(db: Db, input: AnalyticsEventInput): Promise<void> {
  await db.insert(analyticsEvents).values({
    ts: input.ts,
    event: input.event,
    profileId: input.profileId ?? null,
    isGhost: input.isGhost ?? null,
    props: input.props ?? {},
  });
}
