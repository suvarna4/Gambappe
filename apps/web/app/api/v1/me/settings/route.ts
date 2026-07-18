/**
 * `PATCH /api/v1/me/settings` (design doc §9.2, §9.4, WS2-T4). Partial merge onto the existing
 * `profiles.settings` jsonb; the MERGED result is validated against `profileSettingsSchema`
 * before writing (never persist invalid settings). `timezone`, if present, maps to the
 * `profiles.timezone` COLUMN — not a settings key.
 */
import type { NextResponse } from 'next/server';
import { ApiError, profileSettingsSchema, updateSettingsBodySchema } from '@receipts/core';
import { updateProfileById } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function PATCH(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const body = updateSettingsBodySchema.parse(await request.json());
    const { timezone, ...settingsPatch } = body;

    const current = profileSettingsSchema.parse(identity.profile.settings ?? {});
    const merged = profileSettingsSchema.parse({
      ...current,
      ...settingsPatch,
      notifications: { ...current.notifications, ...settingsPatch.notifications },
    });

    const updated = await updateProfileById(getDb(), identity.profile.id, {
      settings: merged,
      ...(timezone !== undefined ? { timezone } : {}),
    });

    return jsonSuccess({ settings: merged, timezone: updated.timezone });
  });
}
