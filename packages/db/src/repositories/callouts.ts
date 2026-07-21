/**
 * Call-out repository (journeys plan §4/§5 WS20-T3, D-J5): challenge-link lifecycle. The token
 * is only ever stored hashed (`tokenHash`); the raw token rides the share URL. `acceptCallout`
 * is the transactional heart — it flips the callout to `accepted` AND mints the next-week
 * nemesis pairing atomically, in canonical `a < b` profile order (matching every other
 * pairing-producing path).
 */
import { eq } from 'drizzle-orm';
import { now } from '@receipts/core';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../client.js';
import { callouts, nemesisPairings } from '../schema/index.js';
import type { NemesisPairingRow } from './moderation.js';

export type CalloutRow = typeof callouts.$inferSelect;
export type NewCalloutRow = typeof callouts.$inferInsert;

export interface CreateCalloutInput {
  challengerProfileId: string;
  /** SHA-256(token) hex; the raw token is never persisted. */
  tokenHash: string;
  /** 24h out (journeys plan §5 WS20-T3); the caller stamps it. */
  expiresAt: Date;
}

export async function createCallout(db: Db, input: CreateCalloutInput): Promise<CalloutRow> {
  const [row] = await db
    .insert(callouts)
    .values({
      id: uuidv7(),
      challengerProfileId: input.challengerProfileId,
      tokenHash: input.tokenHash,
      status: 'pending',
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('createCallout: no row returned');
  return row;
}

export async function getCalloutByTokenHash(db: Db, tokenHash: string): Promise<CalloutRow | null> {
  const [row] = await db
    .select()
    .from(callouts)
    .where(eq(callouts.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export interface AcceptCalloutInput {
  tokenHash: string;
  opponentProfileId: string;
  /** The nemesis season covering `weekStart` (caller resolves/creates it, mirroring nemesis:assign). */
  seasonId: string;
  /** The next-week Monday (YYYY-MM-DD) the created pairing runs in. */
  weekStart: string;
}

export type AcceptCalloutResult =
  | { ok: true; callout: CalloutRow; pairing: NemesisPairingRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_resolved' | 'self_challenge' };

/**
 * Transactional accept: locks the callout row, validates it's still `pending` and unexpired,
 * then flips it to `accepted` and inserts the next-week `nemesis_pairings` row (canonical
 * `a < b`). Idempotent by construction — a second accept sees `status='accepted'` and returns
 * `already_resolved` without touching anything. An expired callout is lazily marked `expired`.
 */
export async function acceptCallout(db: Db, input: AcceptCalloutInput): Promise<AcceptCalloutResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(callouts)
      .where(eq(callouts.tokenHash, input.tokenHash))
      .limit(1)
      .for('update');

    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (row.expiresAt.getTime() <= now().getTime()) {
      await tx
        .update(callouts)
        .set({ status: 'expired', updatedAt: now() })
        .where(eq(callouts.id, row.id));
      return { ok: false, reason: 'expired' };
    }
    if (row.challengerProfileId === input.opponentProfileId) {
      return { ok: false, reason: 'self_challenge' };
    }

    const [profileAId, profileBId] =
      row.challengerProfileId < input.opponentProfileId
        ? [row.challengerProfileId, input.opponentProfileId]
        : [input.opponentProfileId, row.challengerProfileId];

    const [pairing] = await tx
      .insert(nemesisPairings)
      .values({
        id: uuidv7(),
        seasonId: input.seasonId,
        weekStart: input.weekStart,
        profileAId,
        profileBId,
        status: 'scheduled',
        isRematch: false,
      })
      .returning();
    if (!pairing) throw new Error('acceptCallout: no pairing returned');

    const [updated] = await tx
      .update(callouts)
      .set({
        opponentProfileId: input.opponentProfileId,
        status: 'accepted',
        pairingId: pairing.id,
        updatedAt: now(),
      })
      .where(eq(callouts.id, row.id))
      .returning();
    if (!updated) throw new Error('acceptCallout: no callout returned');

    return { ok: true, callout: updated, pairing };
  });
}
