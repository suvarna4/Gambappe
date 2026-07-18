/**
 * Best-effort deep link back to a question's spectator page (`/q/[slug]`, `apps/web/app/q`),
 * used as the optional `ctaUrl` on WS9-T4's `reveal`/`reveal_reminder` beats. Deliberately
 * returns `undefined` instead of throwing when `NEXT_PUBLIC_APP_URL` isn't configured or the
 * question has no `slug` yet — unlike `notify:dispatch`'s `readUnsubscribeLinkConfig` (which
 * intentionally throws to fail a whole dispatch pass loudly), this is called from INSIDE
 * `reveal:fire`'s and `notify:pre-lock-reminder`'s write paths, where a cosmetic CTA link must
 * never block the reveal transaction or the reminder write.
 */
export function buildQuestionUrl(slug: string | null | undefined): string | undefined {
  if (!slug) return undefined;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return undefined;
  return `${appUrl.replace(/\/$/, '')}/q/${slug}`;
}
