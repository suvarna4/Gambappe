/**
 * Pre-lock reminder beat (WS9-T4, §13.2/§19.3 WS9-T4 row: "pre-lock reminder for streak
 * holders"). Pure, DB-free — mirrors `reveal-beats.ts`'s and `reveal-general-beat.ts`'s "no DB,
 * no clock reads" discipline; the caller (`jobs/pre-lock-reminder.ts`) is the only place that
 * touches Postgres.
 *
 * Unlike `reveal`, this beat DOES carry per-user trigger data (the streak length), so per DD-9
 * it goes through `packages/engine`'s `narrate()` rather than a category-level fallback — the
 * `reveal`-category fallback line ("The reveal is ready...") would be actively wrong here since
 * the reveal hasn't happened yet; this fires BEFORE lock, not at reveal.
 */
import { narrate } from '@receipts/engine';
import type { MultiChannelBeatInstruction } from './write-multi-channel-outbox.js';

export interface PreLockReminderBeatInput {
  profileId: string;
  /** The daily's `question_date` (YYYY-MM-DD) that's about to lock — dedupe key's date
   * component (§5.6, matching every other reveal/pre-lock beat's `{beat}:{date}:{profileId}`
   * convention). */
  questionDate: string;
  /** `profiles.current_streak` at candidate-selection time. */
  currentStreak: number;
  /** Deep link back to the question page, if available — same optionality rationale as
   * `reveal-general-beat.ts`. */
  ctaUrl?: string;
}

const KIND = 'reveal_reminder';

/** `notificationCategoryForKind('reveal_reminder')` resolves to the `reveal` category (§13.3
 * beat catalog) — this beat is transactional (cap-exempt) and quiet-hours-exempt (§13.2)
 * exactly like the `reveal` kind, which is desirable: a streak reminder that got deferred to
 * 08:00 the next morning would land well after the question already locked. */
export function derivePreLockReminderBeat(input: PreLockReminderBeatInput): MultiChannelBeatInstruction {
  const rendered = narrate({ beat: 'reveal_reminder', data: { n: input.currentStreak } });
  const payload: Record<string, unknown> = {
    line: rendered.line,
    emphasis: rendered.emphasis,
    subject: 'Your streak is about to lock',
  };
  if (input.ctaUrl) {
    payload['ctaUrl'] = input.ctaUrl;
    payload['ctaLabel'] = 'Pick now';
  }
  return {
    profileId: input.profileId,
    kind: KIND,
    payload,
    dedupeKeyBase: `${KIND}:${input.questionDate}:${input.profileId}`,
  };
}
