/**
 * "Reveal at 8" general beat (WS9-T4, §13.2/§19.3 WS9-T4 row: "'Reveal at 8' push/email").
 * Distinct from WS9-T3's `reveal-beats.ts` per-outcome beats (`streak_milestone`/
 * `streak_busted`/`streak_freeze_used`/`called_it`): every participant gets exactly ONE of
 * these per reveal, regardless of how their day went — "tonight's results are up" — while the
 * per-outcome beats layer their own narration on top for whoever qualifies.
 *
 * Pure, DB-free, mirroring `reveal-beats.ts`'s own "no DB, no clock reads" discipline: the
 * caller (`reveal-fire.ts`) is the only place that touches Postgres, and only calls this from
 * inside the SAME transaction that just flipped a question `locked` → `revealed` (§6.5
 * publication rule — this module is structurally unreachable for a still-`locked` daily, exactly
 * like WS9-T3's beats; see that file's header and `reveal-fire.ts`'s AC comment for the "never
 * before revealed" guard this relies on).
 *
 * Deliberately does NOT call `packages/engine`'s `narrate()`: this beat carries no per-user
 * trigger data (every participant reads the identical announcement), so it leaves
 * `payload.line`/`payload.subject` unset and relies on the `reveal`-category fallback line/
 * subject `notify:dispatch`'s templates already define for exactly this case
 * (`apps/worker/src/lib/notification-email-template.ts`'s `CATEGORY_FALLBACK_LINES.reveal` /
 * `CATEGORY_SUBJECTS.reveal`) — see design doc §13.3's note on this beat. A narrate() beat that
 * just re-produced that same fixed string would be dead weight.
 */
import type { MultiChannelBeatInstruction } from './write-multi-channel-outbox.js';

export interface GeneralRevealBeatInput {
  profileId: string;
  /** The daily's `question_date` (YYYY-MM-DD) that just revealed — dedupe key's date component,
   * matching `reveal-beats.ts`'s convention and WS9-T1's own `reveal:{date}:{profileId}`
   * dedupe-key precedent (`packages/db/test/integration/notifications.test.ts`). */
  questionDate: string;
  /** Deep link back to the question page (`/q/{slug}`), if `NEXT_PUBLIC_APP_URL` is configured
   * at write time — optional so a missing env var never blocks the reveal transaction itself
   * (only cosmetic; the email/push templates render fine with no CTA). */
  ctaUrl?: string;
}

const KIND = 'reveal';

export function deriveGeneralRevealBeat(input: GeneralRevealBeatInput): MultiChannelBeatInstruction {
  const payload: Record<string, unknown> = {};
  if (input.ctaUrl) {
    payload['ctaUrl'] = input.ctaUrl;
    payload['ctaLabel'] = 'See the reveal';
  }
  return {
    profileId: input.profileId,
    kind: KIND,
    payload,
    dedupeKeyBase: `${KIND}:${input.questionDate}:${input.profileId}`,
  };
}
