/**
 * The magic-link sign-in email (§11.1, §13.2 "one template layout (receipt-styled)"; WS25-T3).
 * Mirrors `apps/worker/src/lib/notification-email-template.ts`'s receipt-styled layout and
 * plain-template-literal approach, scaled down for `auth.ts`'s one-shot transactional send: no
 * unsubscribe link — §13.2's List-Unsubscribe requirement is for the §9.4 notification
 * categories a profile can opt out of; there's no "opt out of signing in."
 */
import { PRODUCT_NAME } from '@receipts/core';

export interface RenderedAuthEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `url` is the Auth.js-signed, single-use verification link; `ttlMinutes` mirrors the same
 * `MAGIC_LINK_TTL_MIN` value the link itself is actually bound to (`auth.ts`'s `maxAge`), so the
 * copy never drifts out of sync with the real expiry. */
export function renderMagicLinkEmail(url: string, ttlMinutes: number): RenderedAuthEmail {
  const subject = `Sign in to ${PRODUCT_NAME}`;
  const expiry = `This link expires in ${ttlMinutes} minutes and works once.`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f0;font-family:monospace;color:#111;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border:1px dashed #111;">
      <tr>
        <td style="padding:20px 24px 8px;border-bottom:1px dashed #111;">
          <span style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(PRODUCT_NAME)}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0;font-size:15px;line-height:1.5;">Click below to sign in. ${escapeHtml(expiry)}</p>
          <p style="margin:24px 0 0;">
            <a href="${escapeHtml(url)}"
               style="display:inline-block;padding:10px 18px;border:1px solid #111;color:#111;text-decoration:none;font-family:monospace;">
              Sign in
            </a>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 24px 20px;border-top:1px dashed #111;font-size:11px;color:#666;">
          Didn't request this? You can safely ignore this email.
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${PRODUCT_NAME}\n\nSign in: ${url}\n\n${expiry} Didn't request this? You can safely ignore this email.\n`;

  return { subject, html, text };
}
