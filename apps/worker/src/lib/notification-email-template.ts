/**
 * The ONE shared receipt-styled email layout (§13.2: "one template layout (receipt-styled)").
 * Plain HTML/text, no heavy templating system — a handful of template-literal functions.
 *
 * Content contract: `payload.line` (and optional `payload.emphasis`) is expected to already be
 * the RENDERED narration text — the caller (WS9-T3 beat-wiring) invokes `packages/engine`'s
 * `narrate(beat, data)` (§13.3) at the point a beat fires, where it has full typed trigger
 * data, and stores `{line, emphasis}` (plus whatever else it wants to keep) into the
 * `sendNotification` payload. This file never tries to re-derive a narration line from an
 * untyped jsonb blob — it only knows how to wrap an already-decided line in the receipt chrome.
 * A `payload.line`-less notification (e.g. an early caller that hasn't adopted the contract
 * yet) still renders — with a generic per-category fallback line — rather than throwing and
 * failing the whole dispatch batch.
 */
import { notificationCategoryForKind, type NotificationCategory } from '@receipts/core';

export interface NotificationEmailPayload {
  /** Pre-rendered narration text (§13.3 `narrate()` output) — see file header contract. */
  line?: string;
  emphasis?: string;
  /** Overrides the category-derived default subject line. */
  subject?: string;
  /** Optional "view it" deep link (e.g. back to the question/pairing/duo page). */
  ctaUrl?: string;
  ctaLabel?: string;
  [key: string]: unknown;
}

export interface RenderNotificationEmailOptions {
  unsubscribeUrl: string;
  appName?: string;
}

export interface RenderedNotificationEmail {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

const CATEGORY_SUBJECTS: Record<NotificationCategory, string> = {
  reveal: "Tonight's reveal is in",
  nemesis: 'Nemesis week update',
  duo: 'Duo update',
  product: 'Receipts update',
};

const CATEGORY_FALLBACK_LINES: Record<NotificationCategory, string> = {
  reveal: 'The reveal is ready. Come see how it landed.',
  nemesis: 'Something moved in your nemesis week.',
  duo: 'Something moved with your duo.',
  product: "There's an update on your Receipts activity.",
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders `kind` + its (already-narrated, see file header) `payload` into the receipt layout. */
export function renderNotificationEmail(
  kind: string,
  payload: NotificationEmailPayload,
  opts: RenderNotificationEmailOptions,
): RenderedNotificationEmail {
  const category = notificationCategoryForKind(kind);
  const appName = opts.appName ?? 'Receipts';
  const line = payload.line ?? CATEGORY_FALLBACK_LINES[category];
  const subject = payload.subject ?? CATEGORY_SUBJECTS[category];

  const ctaHtml =
    payload.ctaUrl && payload.ctaLabel
      ? `<p style="margin:24px 0 0;">
           <a href="${escapeHtml(payload.ctaUrl)}"
              style="display:inline-block;padding:10px 18px;border:1px solid #111;color:#111;text-decoration:none;font-family:monospace;">
             ${escapeHtml(payload.ctaLabel)}
           </a>
         </p>`
      : '';
  const ctaText = payload.ctaUrl && payload.ctaLabel ? `\n${payload.ctaLabel}: ${payload.ctaUrl}\n` : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f0;font-family:monospace;color:#111;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border:1px dashed #111;">
      <tr>
        <td style="padding:20px 24px 8px;border-bottom:1px dashed #111;">
          <span style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(appName)}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0;font-size:15px;line-height:1.5;">${escapeHtml(line)}</p>
          ${ctaHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 24px 20px;border-top:1px dashed #111;font-size:11px;color:#666;">
          <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#666;">Unsubscribe from this kind of email</a>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${appName}\n\n${line}\n${ctaText}\n---\nUnsubscribe: ${opts.unsubscribeUrl}\n`;

  return {
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${opts.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
