/**
 * Email transport (§13.2 "Email (MVP): Resend..."; Appendix B `RESEND_API_KEY`/`EMAIL_FROM`).
 *
 * Mirrors `apps/web/lib/magic-link-mailbox.ts`'s WS2-T2 pattern for magic-link delivery: a real
 * provider implementation plus a non-production stub, selected by whether the provider's API
 * key is configured — `auth.ts`'s `sendVerificationRequest` literally throws in production
 * without real Resend wiring and says "WS9 scope," so this file is that wiring's email-channel
 * half (the auth email flow itself isn't touched here — out of scope, see PR notes).
 *
 * Uses the Resend REST API directly via `fetch` rather than the `resend` SDK package — avoids
 * a new dependency for one POST call, and keeps the shape identical to the venue adapters'
 * "plain HTTP, zod-validate the response shape we care about" style (§7.2), scaled down since
 * there's no retry/rate-limit contract to honor here (that's a Resend-side SLA, not ours).
 */
import { logger } from '../logger.js';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailTransport {
  send(email: OutboundEmail): Promise<void>;
}

/** Real delivery via the Resend REST API. */
export class ResendEmailTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: OutboundEmail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers ?? {},
      }),
    });
    if (!res.ok) {
      // §16.2: never log the recipient email — log the outcome + a truncated provider body only.
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed: ${res.status} ${body.slice(0, 500)}`);
    }
  }
}

/**
 * Non-production / no-`RESEND_API_KEY` stub (mirrors `magic-link-mailbox.ts`): logs that a
 * send happened WITHOUT the recipient's email (§16.2 forbids logging emails unconditionally),
 * and keeps an in-memory last-email-per-recipient mailbox for local dev / integration tests to
 * read back — same "never used in production" posture as the magic-link mailbox.
 */
export class LoggingEmailTransport implements EmailTransport {
  private readonly mailbox = new Map<string, OutboundEmail>();

  async send(email: OutboundEmail): Promise<void> {
    this.mailbox.set(email.to, email);
    logger.info(
      { subject: email.subject },
      'notify:dispatch email (stub transport — RESEND_API_KEY not set)',
    );
    await Promise.resolve();
  }

  getLastEmail(to: string): OutboundEmail | undefined {
    return this.mailbox.get(to);
  }

  clear(): void {
    this.mailbox.clear();
  }
}

/** Selects the real Resend transport when `RESEND_API_KEY` is set, else the logging stub. */
export function defaultEmailTransport(): EmailTransport {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return new LoggingEmailTransport();
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set (see .env.example) but RESEND_API_KEY is');
  return new ResendEmailTransport(apiKey, from);
}
