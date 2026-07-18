/**
 * Nemesis scoreboard masking (design doc §9.3: "Nemesis opponents' picks on a shared
 * question are masked until that question locks"). `GET /pairings/:id` is a `none`-auth,
 * ISR-cacheable public endpoint (§9.2, INV-10) — its server-rendered payload cannot vary by
 * viewer, so pre-lock BOTH sides are masked for everyone, including the two participants
 * themselves (each still sees their own pick on the question's own page; this scoreboard
 * specifically hides the competitive signal from the shared view).
 */
import { pairingScoreboardRowSchema } from '@receipts/core';
import type { PairingScoreboardRow } from './types';

/**
 * The full internal record for one shared question, before the public masking rule applies.
 * IDs are plain strings here (not the branded `QuestionId` the real contract uses) — this is
 * pre-validation internal state; `toScoreboardRow` below parses it through the real zod
 * schema on the way out, which is the actual branding boundary.
 */
export interface SharedQuestionRecord {
  question_id: string;
  slug: string;
  kind: PairingScoreboardRow['kind'];
  question_date: PairingScoreboardRow['question_date'];
  /** When this question locks — never sent to the client; only used to decide masking. */
  lock_at: string;
  a: PairingScoreboardRow['a'];
  b: PairingScoreboardRow['b'];
}

/** True once `lockAt` has passed relative to `now` (server clock only, §6.2 step 3 posture). */
export function isLocked(lockAt: string, now: Date): boolean {
  return new Date(lockAt).getTime() <= now.getTime();
}

/**
 * Projects a `SharedQuestionRecord` down to the public `PairingScoreboardRow` shape,
 * nulling both sides' picks when the underlying question hasn't locked yet (§9.3). This is
 * the one function that decides masking — call it for every row before it leaves the
 * server, whether from the real WS5-T4 handler eventually or this mock today. Parses
 * through the real `pairingScoreboardRowSchema` so the output is always contract-shaped.
 */
export function toScoreboardRow(record: SharedQuestionRecord, now: Date): PairingScoreboardRow {
  const locked = isLocked(record.lock_at, now);
  return pairingScoreboardRowSchema.parse({
    question_id: record.question_id,
    slug: record.slug,
    kind: record.kind,
    question_date: record.question_date,
    a: locked ? record.a : null,
    b: locked ? record.b : null,
  });
}
