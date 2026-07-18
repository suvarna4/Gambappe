/**
 * `PickRow` → the wire `pickSchema` shape (§9.2). Owner-facing only — the public/profile-log
 * shape (minute-truncated `picked_at`, no `confidence`) is a separate concern (`GET
 * /profiles/:slug/picks`, not built by WS3).
 */
import type { z } from 'zod';
import type { PickRow } from '@receipts/db';
import type { pickSchema } from '@receipts/core';

export function serializePick(pick: PickRow): z.infer<typeof pickSchema> {
  return {
    id: pick.id as z.infer<typeof pickSchema>['id'],
    question_id: pick.questionId as z.infer<typeof pickSchema>['question_id'],
    profile_id: pick.profileId as z.infer<typeof pickSchema>['profile_id'],
    side: pick.side,
    yes_price_at_entry: pick.yesPriceAtEntry,
    price_stamped_at: pick.priceStampedAt.toISOString(),
    picked_at: pick.pickedAt.toISOString(),
    source: pick.source,
    confidence: pick.confidence,
    result: pick.result,
    edge: pick.edge,
  };
}
