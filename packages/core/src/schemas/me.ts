/**
 * Own-profile API schemas (design doc §9.2: GET /me, PATCH /me/settings, PATCH /me/handle,
 * POST /claim, DELETE /me).
 */
import { z } from 'zod';
import { NEMESIS_MIN_PICKS, DUO_MIN_PICKS } from '../config.js';
import { PROFILE_KIND, PROFILE_STATUS } from '../enums.js';
import { HANDLE_REGEX } from '../handles.js';
import { zProfileId } from '../ids.js';
import { zSlug, zTimestamp } from './common.js';
import { profileSettingsSchema } from './settings.js';

/** Own profile: everything public plus own-only fields (freeze bank, attestation state...). */
export const meProfileSchema = z.object({
  profile_id: zProfileId,
  handle: z.string(),
  slug: zSlug,
  kind: z.enum(PROFILE_KIND),
  status: z.enum(PROFILE_STATUS),
  handle_is_generated: z.boolean(),
  created_at: zTimestamp,
  claimed_at: zTimestamp.nullable(),
  age_attested: z.boolean(),
  timezone: z.string().nullable(),
  streak: z.object({
    current: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
    freeze_bank: z.number().int().nonnegative(),
    last_counted_date: z.string().nullable(),
  }),
  win_streak: z.object({
    current: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
  }),
});

/** Eligibility progress toward the 5/10 mode thresholds (§9.2 GET /me; PRD "real picks"). */
export const eligibilitySchema = z.object({
  graded_picks: z.number().int().nonnegative(),
  nemesis_required: z.literal(NEMESIS_MIN_PICKS),
  duo_required: z.literal(DUO_MIN_PICKS),
  nemesis_eligible: z.boolean(),
  duo_eligible: z.boolean(),
});

// --- GET /me (ghost+) -------------------------------------------------------------------------

export const getMeRequestSchema = z.object({});
export const getMeResponseSchema = z.object({
  profile: meProfileSchema,
  settings: profileSettingsSchema,
  eligibility: eligibilitySchema,
  claim: z.object({ claimed: z.boolean() }),
});

// --- PATCH /me/handle (claimed; custom handle w/ cooldown §6.1.2) -----------------------------

export const updateHandleBodySchema = z
  .object({
    handle: z.string().regex(HANDLE_REGEX, '3–20 chars, [a-zA-Z0-9_]'),
  })
  .strict();

export const updateHandleRequestSchema = z.object({ body: updateHandleBodySchema });
export const updateHandleResponseSchema = z.object({
  handle: z.string(),
  slug: zSlug,
});

// --- DELETE /me (claimed; §11.4 — confirm modal requires typing the handle) -------------------

export const deleteMeBodySchema = z
  .object({
    confirm: z.string().min(1),
  })
  .strict();

export const deleteMeRequestSchema = z.object({ body: deleteMeBodySchema });
export const deleteMeResponseSchema = z.object({ deleted: z.literal(true) });
