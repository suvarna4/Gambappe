/**
 * Outbox persistence for beat instructions (WS9-T3, §5.6 `notifications`). Thin: turns a
 * `RevealBeatInstruction` (or any future beat-instruction shape with the same fields) into an
 * outbox row and inserts it dedupe-safe.
 *
 * SPEC-GAP(WS9-T3): channel dispatch (`notify:dispatch` job, actually sending email/push) is
 * WS9-T1/T2 scope — this only writes the outbox row. `channel` is hardcoded to `'email'`
 * (§13.2: the only channel with dispatch machinery landing this wave; push is V1/opt-in).
 */
import { uuidv7 } from 'uuidv7';
import { insertNotificationIfAbsent, type Db } from '@receipts/db';

export interface BeatInstructionLike {
  profileId: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface WriteOutboxReport {
  written: number;
  deduped: number;
}

/** Writes each instruction as a `notifications` row at `scheduledAt` (immediate — no quiet-hours
 * deferral yet, WS9-T1 scope). Returns counts of newly-written vs. already-present (deduped) rows
 * so callers/tests can assert "fires exactly once per trigger". */
export async function writeBeatsToOutbox(
  db: Db,
  beats: readonly BeatInstructionLike[],
  scheduledAt: Date,
): Promise<WriteOutboxReport> {
  let written = 0;
  let deduped = 0;
  for (const beat of beats) {
    const row = await insertNotificationIfAbsent(db, {
      id: uuidv7(),
      profileId: beat.profileId,
      kind: beat.kind,
      payload: beat.payload,
      channel: 'email',
      scheduledAt,
      dedupeKey: beat.dedupeKey,
    });
    if (row) written += 1;
    else deduped += 1;
  }
  return { written, deduped };
}
