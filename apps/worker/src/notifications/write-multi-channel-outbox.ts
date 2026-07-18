/**
 * Multi-channel outbox persistence (WS9-T4, §13.2 "'Reveal at 8' push/email; pre-lock reminder
 * for streak holders"). WS9-T3's `write-outbox.ts` hardcoded `channel: 'email'` because, at that
 * point, push dispatch (WS9-T2) hadn't merged yet — see that file's header. WS9-T2 has since
 * merged, and this task's own AC row names BOTH channels explicitly, so the two new WS9-T4 beat
 * kinds (`reveal`, `reveal_reminder`) go out on both.
 *
 * Deliberately a NEW file rather than an edit to `write-outbox.ts`: `writeBeatsToOutbox`'s
 * single-channel/single-dedupe-key contract is exercised by WS9-T3's own tests
 * (`reveal-beats-outbox.test.ts`) and reused verbatim by `reveal-fire.ts` for the existing
 * streak_milestone/streak_busted/streak_freeze_used/called_it beats — those should keep behaving
 * exactly as before. `notifications.dedupe_key` is a single GLOBAL unique index (§5.6), not
 * scoped per-channel, so writing the SAME beat to two channels needs two DISTINCT dedupe keys or
 * the second insert silently no-ops as a "duplicate" of the first and that channel's row is
 * lost. This helper appends `:{channel}` to the caller's base key for exactly that reason.
 */
import { sendNotification, type Db } from '@receipts/db';
import type { NotificationChannel } from '@receipts/core';

export interface MultiChannelBeatInstruction {
  profileId: string;
  kind: string;
  payload: Record<string, unknown>;
  /** Base dedupe key WITHOUT a channel suffix — e.g. `reveal:2026-07-19:profile-1`. This helper
   * appends `:email` / `:push` per row so the two channels for one trigger never collide on
   * `notifications.dedupe_key`'s global unique constraint, while a redelivered/re-evaluated
   * trigger for the SAME channel still dedupes correctly (§5.6). */
  dedupeKeyBase: string;
}

export interface WriteMultiChannelOutboxReport {
  written: number;
  deduped: number;
}

/** Channels WS9-T4's beats fire on — both are named explicitly in the §19.3 AC row. */
const CHANNELS: readonly NotificationChannel[] = ['email', 'push'];

/** Writes one beat instruction to the outbox once per channel in `CHANNELS`, each at
 * `scheduledAt`, each dedupe-safe independently. Returns aggregate written/deduped counts across
 * both channels so callers/tests can assert "fires exactly once per trigger per channel". */
export async function writeBeatToOutboxAllChannels(
  db: Db,
  beat: MultiChannelBeatInstruction,
  scheduledAt: Date,
): Promise<WriteMultiChannelOutboxReport> {
  let written = 0;
  let deduped = 0;
  for (const channel of CHANNELS) {
    const result = await sendNotification(
      db,
      beat.profileId,
      beat.kind,
      beat.payload,
      channel,
      `${beat.dedupeKeyBase}:${channel}`,
      scheduledAt,
    );
    if (result.inserted) written += 1;
    else deduped += 1;
  }
  return { written, deduped };
}
