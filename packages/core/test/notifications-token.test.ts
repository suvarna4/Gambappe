/**
 * WS9-T1: one-click unsubscribe token round-trip (§13.2). Split from `notifications.test.ts`
 * when the crypto-based signing moved to `notifications-token.ts` (server-only subpath).
 */
import { describe, expect, it } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../src/notifications-token.js';

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
