/**
 * WS9-T1: notification kind classification (§13.3, §9.4). Unsubscribe-token tests live in
 * `notifications-token.test.ts` (split alongside the crypto-based signing code).
 */
import { describe, expect, it } from 'vitest';
import {
  isTransactionalNotificationKind,
  notificationCategoryForKind,
  notificationSettingsKey,
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
