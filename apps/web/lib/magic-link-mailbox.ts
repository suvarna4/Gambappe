/**
 * Non-production magic-link mailbox stub (design doc §11.1, WS2-T2). Real Resend sending is
 * WS9 scope; this in-memory store lets local dev and integration tests read back the last
 * magic-link URL issued for an email address without a real mail provider. Never used in
 * production (see `auth.ts`'s `sendVerificationRequest`).
 */

const mailbox = new Map<string, string>();

export function recordMagicLink(identifier: string, url: string): void {
  mailbox.set(identifier, url);
}

export function getLastMagicLink(identifier: string): string | undefined {
  return mailbox.get(identifier);
}

export function clearMagicLinkMailbox(): void {
  mailbox.clear();
}
