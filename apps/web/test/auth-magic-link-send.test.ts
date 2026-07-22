/**
 * WS25-T5: the first test in the repo to actually exercise the PRODUCTION email branch of
 * `sendVerificationRequest` — every prior test either covers a piece in isolation
 * (`packages/core/test/email-transport.test.ts`'s `ResendEmailTransport`/`defaultEmailTransport`
 * unit tests) or uses a hand-built fake provider (`auth-error-routing.test.ts`, which only cares
 * about Auth.js's redirect routing, not this repo's own transport wiring). This file sets
 * `RESEND_API_KEY`/`EMAIL_FROM` (forcing the real `ResendEmailTransport` path, not the always-
 * available logging stub) and mocks `fetch`, exercising `sendMagicLinkEmail` — the real,
 * unmodified `auth.ts` handler body (WS25-T5 extracted it into `../lib/auth-magic-link-send.ts`
 * specifically so this is possible; `auth.ts` itself can't be imported under vitest).
 *
 * `enforceAuthEmailSendLimit` is mocked (real Redis isn't available here) — its own pass/fail
 * behavior is covered by `auth-error-routing.test.ts` and `auth-email-limit.ts`'s own callers;
 * this file only cares that a rate-limit throw gets wrapped the same way a transport failure
 * does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@receipts/core';
import { EmailSignInError } from '@auth/core/errors';

const enforceAuthEmailSendLimit = vi.fn<() => Promise<void>>();
vi.mock('../lib/auth-email-limit', () => ({
  enforceAuthEmailSendLimit: (...args: unknown[]) => enforceAuthEmailSendLimit(...(args as [])),
}));

const { sendMagicLinkEmail } = await import('../lib/auth-magic-link-send');

const headers = new Headers();
const url = 'https://receipts.example/api/auth/callback/email?token=abc&email=user%40example.com';

describe('sendMagicLinkEmail — the real auth.ts handler body (WS25-T5)', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    enforceAuthEmailSendLimit.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
    globalThis.fetch = originalFetch;
  });

  it('a rate-limit throw is wrapped as EmailSignInError, never reaching the transport', async () => {
    enforceAuthEmailSendLimit.mockRejectedValue(
      new ApiError('RATE_LIMITED', 'too many sign-in emails'),
    );
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendMagicLinkEmail('user@example.com', url, headers)).rejects.toBeInstanceOf(
      EmailSignInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production path: RESEND_API_KEY set — a successful Resend send resolves cleanly', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'Gambappe <noreply@gambappe.example>';
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendMagicLinkEmail('user@example.com', url, headers)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, init] = fetchMock.mock.calls[0]!;
    expect(reqUrl).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init!.body as string) as {
      to: string[];
      from: string;
      subject: string;
    };
    expect(body.to).toEqual(['user@example.com']);
    expect(body.from).toBe('Gambappe <noreply@gambappe.example>');
    expect(body.subject).toMatch(/Sign in/);
  });

  it('production path: a real Resend send failure is wrapped as EmailSignInError (WS25-T4)', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'noreply@gambappe.example';
    globalThis.fetch = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as unknown as typeof fetch;

    await expect(sendMagicLinkEmail('user@example.com', url, headers)).rejects.toBeInstanceOf(
      EmailSignInError,
    );
  });

  it('production misconfiguration: RESEND_API_KEY set but EMAIL_FROM missing throws EmailSignInError before any fetch', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.EMAIL_FROM;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendMagicLinkEmail('user@example.com', url, headers)).rejects.toBeInstanceOf(
      EmailSignInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-production: RESEND_API_KEY unset resolves via the logging stub, no network call', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendMagicLinkEmail('user@example.com', url, headers)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
