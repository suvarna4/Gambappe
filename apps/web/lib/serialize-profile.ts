/**
 * `ProfileRow` → `meProfileSchema` (§9.2 `GET /me`, `POST /claim` response shape).
 */
import type { z } from 'zod';
import type { ProfileRow } from '@receipts/db';
import type { meProfileSchema } from '@receipts/core';

export function toMeProfile(profile: ProfileRow): z.infer<typeof meProfileSchema> {
  return {
    profile_id: profile.id as z.infer<typeof meProfileSchema>['profile_id'],
    handle: profile.handle,
    slug: profile.slug,
    kind: profile.kind,
    status: profile.status,
    handle_is_generated: profile.handleIsGenerated,
    created_at: profile.createdAt.toISOString(),
    claimed_at: profile.claimedAt ? profile.claimedAt.toISOString() : null,
    age_attested: profile.ageAttestedAt !== null,
    timezone: profile.timezone,
    streak: {
      current: profile.currentStreak,
      best: profile.bestStreak,
      freeze_bank: profile.freezeBank,
      last_counted_date: profile.lastCountedDate,
    },
    win_streak: {
      current: profile.currentWinStreak,
      best: profile.bestWinStreak,
    },
  };
}
