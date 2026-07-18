/**
 * WS9-T2: pure helpers from `lib/push/client.ts`. The browser-API-driving functions
 * (`subscribeToPush`, `registerServiceWorker`, `unsubscribeFromPush`) need a real
 * `navigator.serviceWorker`/`PushManager`, which this repo's unit-test environment (`node`, no
 * jsdom — see `vitest.config.ts`) doesn't provide; those are exercised by the e2e/manual click-
 * through instead. This file covers what's actually pure: the base64url→Uint8Array decode (the
 * one place a bug would silently corrupt every `applicationServerKey`) and the support check.
 */
import { describe, expect, it } from 'vitest';
import { applicationServerKeyMatches, isPushSupported, urlBase64ToUint8Array } from '@/lib/push/client';

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 VAPID-shaped key back to its original bytes', () => {
    // "hello" base64url-encoded, with the URL-safe substitutions and no padding.
    const original = new TextEncoder().encode('hello');
    const base64Url = Buffer.from(original).toString('base64url');

    const decoded = urlBase64ToUint8Array(base64Url);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles the URL-safe "-"/"_" substitutions and missing padding', () => {
    // Bytes chosen so the standard-base64 encoding contains both '+' and '/'.
    const original = new Uint8Array([0xfb, 0xff, 0xbf, 0xff]);
    const base64Url = Buffer.from(original).toString('base64url');
    expect(base64Url).not.toContain('+');
    expect(base64Url).not.toContain('/');

    const decoded = urlBase64ToUint8Array(base64Url);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe('isPushSupported', () => {
  it('is false outside a browser (no window/navigator.serviceWorker/PushManager)', () => {
    expect(isPushSupported()).toBe(false);
  });
});

describe('applicationServerKeyMatches (VAPID key rotation detection)', () => {
  it('is true for identical byte content', () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    const existing = new Uint8Array(key).buffer;
    expect(applicationServerKeyMatches(existing, key)).toBe(true);
  });

  it('is false when the existing subscription has no key on record', () => {
    expect(applicationServerKeyMatches(null, new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('is false when the byte content differs (a rotated VAPID key)', () => {
    const existing = new Uint8Array([1, 2, 3, 4]).buffer;
    const rotated = new Uint8Array([1, 2, 3, 5]);
    expect(applicationServerKeyMatches(existing, rotated)).toBe(false);
  });

  it('is false when the lengths differ', () => {
    const existing = new Uint8Array([1, 2, 3]).buffer;
    const longer = new Uint8Array([1, 2, 3, 4]);
    expect(applicationServerKeyMatches(existing, longer)).toBe(false);
  });
});
