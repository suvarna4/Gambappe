/**
 * WS9-T1: EmailTransport implementations — Resend REST call shape + the non-production
 * logging stub's read-back mailbox (mirrors WS2-T2's magic-link-mailbox.ts pattern).
 *
 * WS25-T2 (auth login fix): moved here from `apps/worker/test/email-transport.test.ts` when
 * the transport moved to `packages/core/src/email-transport.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultEmailTransport,
  LoggingEmailTransport,
  ResendEmailTransport,
} from '../src/email-transport.js';

describe('ResendEmailTransport', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to the Resend REST API with the expected shape', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new ResendEmailTransport('test-key', 'Receipts <noreply@receipts.example>');
    await transport.send({
      to: 'user@example.com',
      subject: 'Reveal is in',
      html: '<p>hi</p>',
      text: 'hi',
      headers: { 'List-Unsubscribe': '<https://example.com/unsub>' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init!.method).toBe('POST');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      from: 'Receipts <noreply@receipts.example>',
      to: ['user@example.com'],
      subject: 'Reveal is in',
      headers: { 'List-Unsubscribe': '<https://example.com/unsub>' },
    });
  });

  it('throws (without leaking the recipient email into the error) on a non-2xx response', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as unknown as typeof fetch;

    const transport = new ResendEmailTransport('test-key', 'noreply@receipts.example');
    await expect(
      transport.send({ to: 'user@example.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow(/429/);
  });
});

describe('LoggingEmailTransport (non-production stub)', () => {
  it('records the last email per recipient for read-back', async () => {
    const transport = new LoggingEmailTransport();
    await transport.send({ to: 'a@example.com', subject: 'first', html: 'h', text: 't' });
    await transport.send({ to: 'a@example.com', subject: 'second', html: 'h', text: 't' });
    await transport.send({ to: 'b@example.com', subject: 'other', html: 'h', text: 't' });

    expect(transport.getLastEmail('a@example.com')?.subject).toBe('second');
    expect(transport.getLastEmail('b@example.com')?.subject).toBe('other');
    expect(transport.getLastEmail('nobody@example.com')).toBeUndefined();
  });

  it('reports each send through an injected logger, without the recipient email', async () => {
    const info = vi.fn();
    const transport = new LoggingEmailTransport({ info });
    await transport.send({ to: 'a@example.com', subject: 'first', html: 'h', text: 't' });

    expect(info).toHaveBeenCalledTimes(1);
    const [obj, msg] = info.mock.calls[0]!;
    expect(obj).toEqual({ subject: 'first' });
    expect(msg).toMatch(/stub transport/);
  });

  it('defaults to a no-op logger when none is supplied', async () => {
    const transport = new LoggingEmailTransport();
    await expect(
      transport.send({ to: 'a@example.com', subject: 'first', html: 'h', text: 't' }),
    ).resolves.toBeUndefined();
  });
});

describe('defaultEmailTransport', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  });

  it('returns the logging stub when RESEND_API_KEY is not set', () => {
    expect(defaultEmailTransport()).toBeInstanceOf(LoggingEmailTransport);
  });

  it('returns the Resend transport when RESEND_API_KEY + EMAIL_FROM are set', () => {
    process.env.RESEND_API_KEY = 'key';
    process.env.EMAIL_FROM = 'noreply@receipts.example';
    expect(defaultEmailTransport()).toBeInstanceOf(ResendEmailTransport);
  });

  it('throws if RESEND_API_KEY is set but EMAIL_FROM is missing', () => {
    process.env.RESEND_API_KEY = 'key';
    expect(() => defaultEmailTransport()).toThrow(/EMAIL_FROM/);
  });

  it('threads a passed-in logger through to the stub transport it returns', async () => {
    const info = vi.fn();
    const transport = defaultEmailTransport({ info });
    expect(transport).toBeInstanceOf(LoggingEmailTransport);

    await transport.send({ to: 'a@example.com', subject: 'first', html: 'h', text: 't' });

    expect(info).toHaveBeenCalledTimes(1);
  });
});
