/**
 * Call-out repository (journeys plan §4/§5 WS20-T3, D-J5): challenge-link lifecycle. The token
 * is only ever stored hashed (`tokenHash`); the raw token rides the share URL. `acceptCallout`
 * is the transactional heart — it flips the callout to `accepted` AND mints the next-week
 * nemesis pairing atomically, in canonical `a < b` profile order (matching every other
 * pairing-producing path).
 */
import { and, desc, eq, or } from 'drizzle-orm';
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

/**
 * Every `accepted` call-out where `profileId` is either the challenger or the accepting opponent
 * (journeys plan §5 WS20-T4, D-J5). Powers the "locked in — you face {handle} next week"
 * confirmation both sides' `/rivals` hubs show after a call-out is accepted (the accepted call-out
 * mints a `scheduled` next-week pairing, which the current-week nemesis surface doesn't render).
 * Newest first. The caller resolves the "other side" profile (challenger vs opponent) for display.
 */
export async function listAcceptedCalloutsForProfile(db: Db, profileId: string): Promise<CalloutRow[]> {
  return db
    .select()
    .from(callouts)
    .where(
      and(
        eq(callouts.status, 'accepted'),
        or(eq(callouts.challengerProfileId, profileId), eq(callouts.opponentProfileId, profileId)),
      ),
    )
    .orderBy(desc(callouts.createdAt));
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

export interface DeclineCalloutInput {
  tokenHash: string;
}

export type DeclineCalloutResult =
  | { ok: true; callout: CalloutRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_resolved' };

/**
 * Transactional decline (WS20-T3): locks the callout, validates it's still `pending` and
 * unexpired, then flips it to `declined`. Idempotent/terminal-safe like `acceptCallout` — a
 * second decline (or a decline of an already-accepted/-declined callout) sees a non-`pending`
 * status and returns `already_resolved` without mutating anything; an expired-by-time callout is
 * lazily marked `expired` and returns `expired`. Decline needs no opponent/season/pairing — it
 * simply closes the challenge, so no `nemesis_pairings` row is ever created here.
 */
export async function declineCallout(db: Db, input: DeclineCalloutInput): Promise<DeclineCalloutResult> {
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

    const [updated] = await tx
      .update(callouts)
      .set({ status: 'declined', updatedAt: now() })
      .where(eq(callouts.id, row.id))
      .returning();
    if (!updated) throw new Error('declineCallout: no callout returned');

    return { ok: true, callout: updated };
  });
}
