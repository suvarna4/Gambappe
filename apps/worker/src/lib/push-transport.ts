/**
 * Web push transport (§13.2 "Web push (V1, flag): VAPID via `web-push`"; Appendix B
 * `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`). Mirrors `email-transport.ts`'s real-provider /
 * logging-stub split exactly, selected by whether the VAPID keys are configured.
 */
import webpush, { WebPushError } from 'web-push';
import { logger } from '../logger.js';

export interface PushSubscriptionTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface OutboundPush {
  subscription: PushSubscriptionTarget;
  title: string;
  body: string;
  url?: string;
  /** SW7-T1: axis-ordered pick action buttons ([✕ {no}] [{yes} ✓]); omitted for every existing
   * beat and for iOS-Safari targets, so their serialized payload is unchanged. */
  actions?: Array<{ action: string; title: string }>;
  /** SW7-T1: extra `notification.data` (question id + labels) the SW needs to POST a pick. */
  data?: Record<string, unknown>;
}

export interface PushSendResult {
  /** True when the push service reported the endpoint gone (404/410 — uninstalled, expired,
   * or permission revoked). The caller revokes the subscription row on this signal; any other
   * failure is a transient send error, not proof the endpoint is dead. */
  revoked: boolean;
}

export interface PushTransport {
  send(push: OutboundPush): Promise<PushSendResult>;
}

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Real delivery via the `web-push` library (Web Push Protocol + VAPID). */
export class WebPushTransport implements PushTransport {
  constructor(private readonly vapidDetails: VapidDetails) {}

  async send(push: OutboundPush): Promise<PushSendResult> {
    // `actions`/`data` are spread in only when present so every existing beat serializes to the
    // exact same `{title, body, url}` it did before SW7-T1 (the SW reads them when they exist).
    const payload = JSON.stringify({
      title: push.title,
      body: push.body,
      url: push.url ?? '/',
      ...(push.actions ? { actions: push.actions } : {}),
      ...(push.data ? { data: push.data } : {}),
    });
    try {
      await webpush.sendNotification(push.subscription, payload, {
        vapidDetails: this.vapidDetails,
      });
      return { revoked: false };
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        return { revoked: true };
      }
      throw err;
    }
  }
}

/**
 * Non-production / no-VAPID-keys stub (mirrors `LoggingEmailTransport`): logs that a send
 * happened and keeps an in-memory last-push-per-endpoint mailbox for local dev / integration
 * tests to read back.
 */
export class LoggingPushTransport implements PushTransport {
  private readonly mailbox = new Map<string, OutboundPush>();

  async send(push: OutboundPush): Promise<PushSendResult> {
    this.mailbox.set(push.subscription.endpoint, push);
    logger.info(
      { title: push.title },
      'notify:dispatch push (stub transport — VAPID keys not set)',
    );
    await Promise.resolve();
    return { revoked: false };
  }

  getLastPush(endpoint: string): OutboundPush | undefined {
    return this.mailbox.get(endpoint);
  }

  clear(): void {
    this.mailbox.clear();
  }
}

/** Selects the real transport when both VAPID keys are set, else the logging stub. Subject is
 * the app URL (VAPID accepts an `https:` URL or a `mailto:` address as the contact identity —
 * reusing the already-required `NEXT_PUBLIC_APP_URL` avoids parsing `EMAIL_FROM`'s free-form
 * display-name format for an unrelated purpose). */
export function defaultPushTransport(): PushTransport {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return new LoggingPushTransport();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl)
    throw new Error('NEXT_PUBLIC_APP_URL is not set (see .env.example) but VAPID keys are');

  return new WebPushTransport({ subject: appUrl, publicKey, privateKey });
}
