/**
 * `ProfileSettings` — the COMPLETE user-writable settings blob (design doc §9.4).
 * `.strict()` everywhere: unknown keys are rejected. Server-managed state (e.g.
 * `matchmaking_priority`) lives in columns, never here.
 */
import { z } from 'zod';

export const notificationSettingsSchema = z
  .object({
    email_reveal: z.boolean().default(true),
    email_nemesis: z.boolean().default(true),
    email_duo: z.boolean().default(true),
    /** Anything non-transactional. */
    email_product: z.boolean().default(false),
    /** Only meaningful once subscribed. */
    push_reveal: z.boolean().default(true),
    push_nemesis: z.boolean().default(true),
    push_duo: z.boolean().default(true),
  })
  .strict();

export const profileSettingsSchema = z
  .object({
    /** Pauses nemesis matchmaking (PRD §4.2 opt-out). */
    nemesis_paused: z.boolean().default(false),
    /** §12.5 separate opt-in. */
    show_wallet_address: z.boolean().default(false),
    notifications: notificationSettingsSchema.default({}),
  })
  .strict();

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** Resolved defaults for a fresh profile (`settings` column default `{}` + zod defaults). */
export const PROFILE_SETTINGS_DEFAULTS: ProfileSettings = profileSettingsSchema.parse({});

/**
 * PATCH /me/settings body (§9.2): a partial ProfileSettings; may also carry `timezone`,
 * which the handler maps to the `profiles.timezone` COLUMN (not a settings key).
 */
export const updateSettingsBodySchema = z
  .object({
    nemesis_paused: z.boolean().optional(),
    show_wallet_address: z.boolean().optional(),
    notifications: notificationSettingsSchema.partial().optional(),
    /** IANA zone from the browser (§5.2 `profiles.timezone`). */
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export const updateSettingsResponseSchema = z.object({
  settings: profileSettingsSchema,
  timezone: z.string().nullable(),
});
