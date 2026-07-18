/**
 * Duplicate-account heuristics (design doc §14.4, WS11-T4): "same verified email family
 * (dots/plus normalization) blocked at auth." Best-effort only (§14.4, §7) — no
 * fingerprinting SDKs, no device IDs; this is pure string canonicalization of an email a
 * user already typed in.
 *
 * Dot-insensitivity is a Gmail-specific mailbox behavior (`a.b@gmail.com` and `ab@gmail.com`
 * deliver to the same inbox) — NOT a general email convention, so it's only applied for
 * gmail.com/googlemail.com. Plus-addressing (`user+tag@domain`) is stripped for every domain:
 * it's a widely-supported convention (Gmail, Outlook, Fastmail, iCloud, ...) for routing mail
 * to the same inbox under a tag, so treating `a+b@x` and `a@x` as the same account family is
 * safe generally, not just for Gmail.
 */

/**
 * Canonical form of `email` for duplicate-family comparison — NOT a validated/deliverable
 * address, just a comparison key. Malformed input (no `@`) is lowercased/trimmed and returned
 * as-is rather than thrown on; email format validation is a separate concern (zod schemas).
 */
export function normalizeEmailForDuplicateCheck(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return trimmed;

  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);

  const plusIdx = local.indexOf('+');
  if (plusIdx !== -1) local = local.slice(0, plusIdx);

  // googlemail.com is a literal alias for gmail.com — same mailbox space.
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replaceAll('.', '');

  return `${local}@${domain}`;
}
