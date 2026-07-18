/**
 * WS9-T1: notification kind classification + one-click unsubscribe token round-trip (§13.2,
 * §13.3, §9.4).
 */
import { describe, expect, it } from 'vitest';
import {
  isTransactionalNotificationKind,
  notificationCategoryForKind,
  notificationSettingsKey,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../src/notifications.js';

describe('notificationCategoryForKind (§13.3 beat catalog)', () => {
  it('classifies nemesis_* beats', () => {
    expect(notificationCategoryForKind('nemesis_assigned')).toBe('nemesis');
    expect(notificationCategoryForKind('nemesis_verdict_win')).toBe('nemesis');
  });

  it('classifies duo_* beats', () => {
    expect(notificationCategoryForKind('duo_formed')).toBe('duo');
    expect(notificationCategoryForKind('duo_promoted')).toBe('duo');
  });

  it('classifies reveal and reveal_* kinds', () => {
    expect(notificationCategoryForKind('reveal')).toBe('reveal');
    expect(notificationCategoryForKind('reveal_reminder')).toBe('reveal');
  });

  it('falls back to product for everything else (streak/called_it/claim_nudge/unknown)', () => {
    expect(notificationCategoryForKind('streak_milestone')).toBe('product');
    expect(notificationCategoryForKind('streak_busted')).toBe('product');
    expect(notificationCategoryForKind('called_it')).toBe('product');
    expect(notificationCategoryForKind('claim_nudge_streak')).toBe('product');
    expect(notificationCategoryForKind('some_future_beat')).toBe('product');
  });
});

describe('isTransactionalNotificationKind (§13.2)', () => {
  it('reveal/nemesis/duo are transactional (cap-exempt)', () => {
    expect(isTransactionalNotificationKind('reveal')).toBe(true);
    expect(isTransactionalNotificationKind('nemesis_lead_taken')).toBe(true);
    expect(isTransactionalNotificationKind('duo_synergy_up')).toBe(true);
  });

  it('everything else is non-transactional (subject to the daily cap)', () => {
    expect(isTransactionalNotificationKind('streak_milestone')).toBe(false);
    expect(isTransactionalNotificationKind('called_it')).toBe(false);
  });
});

describe('notificationSettingsKey (§9.4 ProfileSettings.notifications)', () => {
  it('maps kind+channel to the matching settings key', () => {
    expect(notificationSettingsKey('nemesis_assigned', 'email')).toBe('email_nemesis');
    expect(notificationSettingsKey('duo_formed', 'email')).toBe('email_duo');
    expect(notificationSettingsKey('reveal', 'email')).toBe('email_reveal');
    expect(notificationSettingsKey('streak_milestone', 'email')).toBe('email_product');
    expect(notificationSettingsKey('nemesis_assigned', 'push')).toBe('push_nemesis');
    expect(notificationSettingsKey('duo_formed', 'push')).toBe('push_duo');
    expect(notificationSettingsKey('reveal', 'push')).toBe('push_reveal');
  });

  it('push has no "product" setting at MVP — returns null (no opt-out control exists)', () => {
    expect(notificationSettingsKey('streak_milestone', 'push')).toBeNull();
  });
});

describe('unsubscribe token sign/verify round-trip', () => {
  const secret = 'test-unsub-secret';

  it('round-trips profileId + category', () => {
    const token = signUnsubscribeToken({ profileId: 'abc-123', category: 'nemesis' }, secret);
    expect(verifyUnsubscribeToken(token, secret)).toEqual({
      profileId: 'abc-123',
      category: 'nemesis',
    });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signUnsubscribeToken({ profileId: 'abc-123', category: 'duo' }, secret);
    expect(verifyUnsubscribeToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signUnsubscribeToken({ profileId: 'abc-123', category: 'product' }, secret);
    const [payloadB64, signature] = token.split('.') as [string, string];
    const tamperedPayload = Buffer.from(
      JSON.stringify({ profileId: 'someone-else', category: 'product' }),
    ).toString('base64url');
    expect(verifyUnsubscribeToken(`${tamperedPayload}.${signature}`, secret)).toBeNull();
    expect(payloadB64).not.toBe(tamperedPayload);
  });

  it('rejects malformed tokens without throwing', () => {
    expect(verifyUnsubscribeToken('not-a-token', secret)).toBeNull();
    expect(verifyUnsubscribeToken('', secret)).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c', secret)).toBeNull();
  });
});
