/**
 * Server-side direct event emission (§13.1: "server code emits server events directly").
 * For jobs and route handlers that already know an event happened, without a round-trip
 * through POST /events. Same drop rule as the HTTP path — oversized props are dropped
 * silently — and analytics never breaks the caller: insert failures are logged, not thrown.
 */
import { EVENT_PROPS_MAX_BYTES, now } from '@receipts/core';
import type { AnalyticsEventName } from '@receipts/core';
import { insertAnalyticsEvent, type Db } from '@receipts/db';
import { logger } from './logger';

export interface EmitEventInput {
  event: AnalyticsEventName;
  props?: Record<string, unknown>;
  profileId?: string | null;
  isGhost?: boolean | null;
  anonId?: string | null;
  ipHash?: string | null;
  uaHash?: string | null;
}

function propsByteSize(props: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(props), 'utf8');
}

export async function emitEvent(db: Db, input: EmitEventInput): Promise<void> {
  const props = input.props ?? {};
  if (propsByteSize(props) > EVENT_PROPS_MAX_BYTES) {
    logger.warn(
      { event: input.event },
      'emitEvent: props exceeded EVENT_PROPS_MAX_BYTES, dropping',
    );
    return;
  }
  try {
    await insertAnalyticsEvent(db, {
      ts: now(),
      event: input.event,
      profileId: input.profileId ?? null,
      isGhost: input.isGhost ?? null,
      anonId: input.anonId ?? null,
      props,
      ipHash: input.ipHash ?? null,
      uaHash: input.uaHash ?? null,
    });
  } catch (err) {
    logger.error({ err, event: input.event }, 'emitEvent: insert failed');
  }
}
