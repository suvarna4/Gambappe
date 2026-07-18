/**
 * WS9-T2: PushTransport implementations — the `web-push` call shape, 404/410 → `revoked: true`
 * translation, and the non-production logging stub's read-back mailbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush, { WebPushError } from 'web-push';
import {
  defaultPushTransport,
  LoggingPushTransport,
  WebPushTransport,
} from '../src/lib/push-transport.js';

vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public headers: Record<string, string>,
      public body: string,
      public endpoint: string,
    ) {
      super(message);
    }
  }
  return {
    default: { sendNotification: vi.fn() },
    WebPushError,
  };
});

const subscription = { endpoint: 'https://push.example/ep', keys: { p256dh: 'p', auth: 'a' } };

describe('WebPushTransport', () => {
  afterEach(() => {
    vi.mocked(webpush.sendNotification).mockReset();
  });

  it('calls web-push sendNotification with the JSON payload + vapidDetails', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    const transport = new WebPushTransport({
      subject: 'https://receipts.example',
      publicKey: 'pub',
      privateKey: 'priv',
    });
    const result = await transport.send({ subscription, title: 'Reveal is in', body: 'Come see', url: '/q/today' });

    expect(result.revoked).toBe(false);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [sentSubscription, payload, options] = vi.mocked(webpush.sendNotification).mock.calls[0]!;
    expect(sentSubscription).toEqual(subscription);
    expect(JSON.parse(payload as string)).toEqual({ title: 'Reveal is in', body: 'Come see', url: '/q/today' });
    expect(options?.vapidDetails).toEqual({ subject: 'https://receipts.example', publicKey: 'pub', privateKey: 'priv' });
  });

  it('translates a 404 WebPushError into revoked: true rather than throwing', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(new WebPushError('gone', 404, {}, '', subscription.endpoint));

    const transport = new WebPushTransport({ subject: 's', publicKey: 'pub', privateKey: 'priv' });
    const result = await transport.send({ subscription, title: 't', body: 'b' });
    expect(result.revoked).toBe(true);
  });

  it('translates a 410 WebPushError into revoked: true rather than throwing', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(new WebPushError('gone', 410, {}, '', subscription.endpoint));

    const transport = new WebPushTransport({ subject: 's', publicKey: 'pub', privateKey: 'priv' });
    const result = await transport.send({ subscription, title: 't', body: 'b' });
    expect(result.revoked).toBe(true);
  });

  it('rethrows a non-404/410 WebPushError (transient failure, not a dead endpoint)', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(new WebPushError('rate limited', 429, {}, '', subscription.endpoint));

    const transport = new WebPushTransport({ subject: 's', publicKey: 'pub', privateKey: 'priv' });
    await expect(transport.send({ subscription, title: 't', body: 'b' })).rejects.toThrow('rate limited');
  });
});

describe('LoggingPushTransport (non-production stub)', () => {
  it('records the last push per endpoint for read-back', async () => {
    const transport = new LoggingPushTransport();
    await transport.send({ subscription, title: 'first', body: 'b' });
    await transport.send({ subscription: { ...subscription, endpoint: 'https://push.example/ep2' }, title: 'second', body: 'b' });

    expect(transport.getLastPush(subscription.endpoint)?.title).toBe('first');
    expect(transport.getLastPush('https://push.example/ep2')?.title).toBe('second');
    expect(transport.getLastPush('https://push.example/never')).toBeUndefined();
  });
});

describe('defaultPushTransport', () => {
  const originalPublic = process.env.VAPID_PUBLIC_KEY;
  const originalPrivate = process.env.VAPID_PRIVATE_KEY;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (originalPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = originalPublic;
    if (originalPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = originalPrivate;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it('returns the logging stub when VAPID keys are not set', () => {
    expect(defaultPushTransport()).toBeInstanceOf(LoggingPushTransport);
  });

  it('returns the WebPushTransport when VAPID keys + app URL are set', () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.NEXT_PUBLIC_APP_URL = 'https://receipts.example';
    expect(defaultPushTransport()).toBeInstanceOf(WebPushTransport);
  });

  it('throws if VAPID keys are set but NEXT_PUBLIC_APP_URL is missing', () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    expect(() => defaultPushTransport()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
