/**
 * WS9-T4 (§13.2 "pre-lock reminder for streak holders"): pure unit tests for
 * `derivePreLockReminderBeat`. DB-free.
 */
import { describe, expect, it } from 'vitest';
import { derivePreLockReminderBeat } from '../src/notifications/pre-lock-reminder-beat.js';

describe('derivePreLockReminderBeat (§13.2/§19.3 WS9-T4)', () => {
  it('produces a `reveal_reminder`-kind instruction with a narrated line carrying the streak length', () => {
    const beat = derivePreLockReminderBeat({
      profileId: 'profile-1',
      questionDate: '2026-07-19',
      currentStreak: 5,
    });
    expect(beat.kind).toBe('reveal_reminder');
    expect(beat.payload['line']).toBe('Your 5-day streak is on the line. Pick before it locks.');
    expect(beat.payload['subject']).toBe('Your streak is about to lock');
    expect(beat.dedupeKeyBase).toBe('reveal_reminder:2026-07-19:profile-1');
  });

  it('a different streak length produces a different golden line', () => {
    const beat = derivePreLockReminderBeat({
      profileId: 'profile-1',
      questionDate: '2026-07-19',
      currentStreak: 1,
    });
    expect(beat.payload['line']).toBe('Your 1-day streak is on the line. Pick before it locks.');
  });

  it('includes ctaUrl/ctaLabel when a deep link is supplied, omits both otherwise', () => {
    const withUrl = derivePreLockReminderBeat({
      profileId: 'profile-1',
      questionDate: '2026-07-19',
      currentStreak: 3,
      ctaUrl: 'https://receipts.example/q/2026-07-19-test',
    });
    expect(withUrl.payload['ctaUrl']).toBe('https://receipts.example/q/2026-07-19-test');
    expect(withUrl.payload['ctaLabel']).toBe('Pick now');

    const withoutUrl = derivePreLockReminderBeat({
      profileId: 'profile-1',
      questionDate: '2026-07-19',
      currentStreak: 3,
    });
    expect('ctaUrl' in withoutUrl.payload).toBe(false);
  });

  it('dedupe key varies by profile and by date', () => {
    const a = derivePreLockReminderBeat({ profileId: 'profile-1', questionDate: '2026-07-19', currentStreak: 3 });
    const otherProfile = derivePreLockReminderBeat({
      profileId: 'profile-2',
      questionDate: '2026-07-19',
      currentStreak: 3,
    });
    expect(otherProfile.dedupeKeyBase).not.toBe(a.dedupeKeyBase);

    const otherDate = derivePreLockReminderBeat({
      profileId: 'profile-1',
      questionDate: '2026-07-20',
      currentStreak: 3,
    });
    expect(otherDate.dedupeKeyBase).not.toBe(a.dedupeKeyBase);
  });
});
