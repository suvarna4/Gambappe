/**
 * WS2-T4 AC: zod rejects unknown keys on both PATCH bodies (`.strict()` schemas from core).
 */
import { describe, expect, it } from 'vitest';
import { updateHandleBodySchema, updateSettingsBodySchema, profileSettingsSchema } from '@receipts/core';

describe('updateSettingsBodySchema (.strict())', () => {
  it('accepts a valid partial patch', () => {
    expect(() =>
      updateSettingsBodySchema.parse({ nemesis_paused: true, notifications: { email_reveal: false } }),
    ).not.toThrow();
  });

  it('rejects an unknown top-level key', () => {
    expect(() => updateSettingsBodySchema.parse({ bogus_key: true })).toThrow();
  });

  it('rejects an unknown nested notifications key', () => {
    expect(() =>
      updateSettingsBodySchema.parse({ notifications: { email_reveal: true, bogus: true } }),
    ).toThrow();
  });

  it('a merged partial patch still validates against the full settings schema', () => {
    const current = profileSettingsSchema.parse({});
    const patch = updateSettingsBodySchema.parse({ show_wallet_address: true });
    const { timezone: _tz, ...settingsPatch } = patch;
    const merged = profileSettingsSchema.parse({
      ...current,
      ...settingsPatch,
      notifications: { ...current.notifications, ...settingsPatch.notifications },
    });
    expect(merged.show_wallet_address).toBe(true);
    expect(merged.nemesis_paused).toBe(false);
  });
});

describe('updateHandleBodySchema (.strict())', () => {
  it('accepts a well-formed handle', () => {
    expect(() => updateHandleBodySchema.parse({ handle: 'CoolFox_1' })).not.toThrow();
  });

  it('rejects an unknown key', () => {
    expect(() => updateHandleBodySchema.parse({ handle: 'CoolFox_1', extra: true })).toThrow();
  });

  it('rejects a malformed handle', () => {
    expect(() => updateHandleBodySchema.parse({ handle: 'ab' })).toThrow();
    expect(() => updateHandleBodySchema.parse({ handle: 'has spaces here' })).toThrow();
  });
});
