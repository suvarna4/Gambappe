/**
 * Email transport (§13.2 "Email (MVP): Resend..."; Appendix B `RESEND_API_KEY`/`EMAIL_FROM`).
 *
 * WS25-T2 (auth login fix): moved here from `apps/worker/src/lib/email-transport.ts` so
 * `apps/web`'s Auth.js magic-link `sendVerificationRequest` (WS25-T3) can send real email
 * through the same transport `notify:dispatch` uses, instead of duplicating the Resend call
 * shape into a second package. See `receipts-design-doc.md` §4.2 for why this lives in
 * `packages/core` rather than `packages/venues` (the repo's other real/mock-adapter home,
 * but scoped to prediction-market data sources, not a generic email provider).
 *
 * Node-only (`fetch` is fine, but this is paired with `LoggingEmailTransport`'s logger
 * injection below, which assumes a server-side caller) — lives under `./server`, not the main
 * barrel, matching every other file in this directory.
 *
 * Uses the Resend REST API directly via `fetch` rather than the `resend` SDK package — avoids
 * a new dependency for one POST call, and keeps the shape identical to the venue adapters'
 * "plain HTTP, zod-validate the response shape we care about" style (§7.2), scaled down since
 * there's no retry/rate-limit contract to honor here (that's a Resend-side SLA, not ours).
 */
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
 * Minimal structural logger — just enough of pino's `.info(obj, msg)` shape for
 * `LoggingEmailTransport` to report a send without this package depending on pino itself
 * (`packages/core` has no logging dependency, and shouldn't gain one just for this).
 */
export interface StubTransportLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: StubTransportLogger = { info: () => {} };

/**
 * Non-production / no-`RESEND_API_KEY` stub: logs that a send happened WITHOUT the recipient's
 * email (§16.2 forbids logging emails unconditionally, not just in production), and keeps an
 * in-memory last-email-per-recipient mailbox for local dev / integration tests to read back —
 * never used in production. WS25-T3: `apps/web/auth.ts`'s magic-link `sendVerificationRequest`
 * now falls back to this stub too (via `defaultEmailTransport()`) instead of the bespoke
 * `apps/web/lib/magic-link-mailbox.ts` it used to use, which is retired. NOTE: unlike
 * `magic-link-mailbox.ts`'s module-level singleton `Map`, `defaultEmailTransport()` constructs a
 * fresh, uncaptured `LoggingEmailTransport` on every call — nothing currently retains a
 * reference, so `auth.ts`'s magic links have no read-back path today. Read-back for that caller
 * requires the caller to hold onto (or be injected) the same instance across calls, the way
 * `apps/worker`'s integration tests already do; a future task adding that here should not assume
 * this class alone reproduces `getLastMagicLink`'s capability.
 *
 * The logger is optional (default: no-op) rather than a required constructor argument — callers
 * that only care about the read-back mailbox (e.g. tests injecting this transport directly)
 * don't need to supply one; `defaultEmailTransport()` passes its caller's real logger through.
 */
export class LoggingEmailTransport implements EmailTransport {
  private readonly mailbox = new Map<string, OutboundEmail>();

  constructor(private readonly logger: StubTransportLogger = noopLogger) {}

  async send(email: OutboundEmail): Promise<void> {
    this.mailbox.set(email.to, email);
    this.logger.info(
      { subject: email.subject },
      'email send (stub transport — RESEND_API_KEY not set)',
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
export function defaultEmailTransport(logger?: StubTransportLogger): EmailTransport {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return new LoggingEmailTransport(logger);
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set (see .env.example) but RESEND_API_KEY is');
  return new ResendEmailTransport(apiKey, from);
}
