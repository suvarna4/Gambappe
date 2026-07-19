/**
 * SW7-T1: axis-ordered pick actions, iOS-Safari capability detection, and payload parsing — the
 * pure pieces the template/dispatcher/service-worker all share (swipe-ux-plan §2.11).
 */
import { describe, expect, it } from 'vitest';
import {
  buildPickActions,
  parsePickActionPayload,
  PICK_ACTION_NO,
  PICK_ACTION_YES,
  supportsNotificationActions,
} from '../src/lib/notification-push-actions.js';

describe('buildPickActions (D-SW9 axis)', () => {
  it('orders against/no LEFT (index 0), for/yes RIGHT (index 1) — matching the wells and the swipe', () => {
    const actions = buildPickActions({ yesLabel: 'CUTS', noLabel: 'HOLDS' });
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ action: PICK_ACTION_NO, title: '✕ HOLDS' });
    expect(actions[1]).toEqual({ action: PICK_ACTION_YES, title: 'CUTS ✓' });
  });
});

describe('supportsNotificationActions', () => {
  it('returns false for Apple Web Push endpoints (iOS Safari renders no actions)', () => {
    expect(supportsNotificationActions('https://web.push.apple.com/abc123')).toBe(false);
    expect(supportsNotificationActions('https://sandbox.push.apple.com/abc123')).toBe(false);
  });

  it('returns true for FCM / Mozilla / WNS endpoints', () => {
    expect(supportsNotificationActions('https://fcm.googleapis.com/fcm/send/xyz')).toBe(true);
    expect(
      supportsNotificationActions('https://updates.push.services.mozilla.com/wpush/v2/abc'),
    ).toBe(true);
    expect(supportsNotificationActions('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(
      true,
    );
  });

  it('treats a malformed endpoint as capable (worst case: ignored actions, never a missing fallback)', () => {
    expect(supportsNotificationActions('not a url')).toBe(true);
  });

  it('is not fooled by an apple substring in a non-apple host', () => {
    expect(supportsNotificationActions('https://push.apple.com.evil.example/x')).toBe(true);
  });
});

describe('parsePickActionPayload', () => {
  it('extracts a well-formed pick descriptor', () => {
    expect(
      parsePickActionPayload({
        questionId: 'q_1',
        yesLabel: 'CUTS',
        noLabel: 'HOLDS',
        url: '/q/today',
      }),
    ).toEqual({ questionId: 'q_1', yesLabel: 'CUTS', noLabel: 'HOLDS', url: '/q/today' });
  });

  it('returns null when absent, non-object, or missing a required field', () => {
    expect(parsePickActionPayload(undefined)).toBeNull();
    expect(parsePickActionPayload(null)).toBeNull();
    expect(parsePickActionPayload('nope')).toBeNull();
    expect(parsePickActionPayload({ yesLabel: 'CUTS', noLabel: 'HOLDS' })).toBeNull();
    expect(
      parsePickActionPayload({ questionId: '', yesLabel: 'CUTS', noLabel: 'HOLDS' }),
    ).toBeNull();
  });

  it('drops a non-string url rather than passing it through', () => {
    const parsed = parsePickActionPayload({
      questionId: 'q_1',
      yesLabel: 'A',
      noLabel: 'B',
      url: 42,
    });
    expect(parsed).toEqual({ questionId: 'q_1', yesLabel: 'A', noLabel: 'B', url: undefined });
  });
});
