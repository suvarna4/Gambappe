/**
 * Shared share path for call-out challenge links (docs/xtrace-hackathon-tasks.md XH-T7).
 * Extracted out of `CalloutButton.tsx` (previously module-private there, with no `text`
 * parameter) so `CalloutDraftButton.tsx` can share the same native-share/clipboard-fallback
 * path with drafted banter text riding alongside the link. `CalloutButton` itself passes no
 * `text` and is behaviorally unchanged by this extraction.
 *
 * Native share (URL only, or URL + text) where available, else the shared clipboard fallback.
 * Returns true when the clipboard path was taken (so the caller shows a "copied" confirmation)
 * and false when the OS share sheet handled it. A user dismissing the native sheet (AbortError)
 * or any native failure falls back to clipboard rather than surfacing an error.
 */
import { copyShareLink } from '@/lib/share-client';

export async function shareCalloutLink(
  url: string,
  title: string,
  text?: string,
): Promise<boolean> {
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> })
      : undefined;
  if (nav?.share) {
    try {
      await nav.share(text ? { url, title, text } : { url, title });
      return false;
    } catch {
      // fall through to clipboard
    }
  }
  await copyShareLink(text ? `${text} ${url}` : url);
  return true;
}
