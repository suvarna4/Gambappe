/**
 * Nemesis pairing repository helpers (design doc §5.5). The by-id lookup + `getPairingWithProfiles`
 * were WS8-T1 scope (the `/api/og/matchup/:id` OG card only needed a pairing plus its two
 * profiles' handles/slugs). This task (WS5-T4, §9.2/§9.3) adds the rest of the
 * `/api/v1/pairings/*` route surface's data-access needs: the full scoreboard question set
 * (for masking, §9.3) and a profile's lifetime pairing history (`GET /me/nemesis-history`).
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { MarketSide, PickResult, QuestionKind } from '@receipts/core';
import type { Db } from '../client.js';
import { nemesisPairings, pairingReactions, profiles } from '../schema/index.js';
// `NemesisPairingRow` already lives in moderation.ts (WS11-T3) and is re-exported from
// `index.ts` via that module — imported (not re-declared/re-exported) here to avoid an
// ambiguous duplicate `export *` of the same name from two repository files. Same reasoning
// now applies to `NewNemesisPairingRow`, which WS5-T1's nemesis.ts also declares.
import type { NemesisPairingRow } from './moderation.js';
import type { NewNemesisPairingRow } from './nemesis.js';

export async function insertNemesisPairing(
  db: Db,
  row: NewNemesisPairingRow,
): Promise<NemesisPairingRow> {
  const [inserted] = await db.insert(nemesisPairings).values(row).returning();
  if (!inserted) throw new Error('insertNemesisPairing: no row returned');
  return inserted;
}

export async function getPairingById(db: Db, id: string): Promise<NemesisPairingRow | null> {
  const [row] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, id)).limit(1);
  return row ?? null;
}

export interface PairingWithProfiles {
  pairing: NemesisPairingRow;
  profileA: typeof profiles.$inferSelect;
  profileB: typeof profiles.$inferSelect;
}

/** Pairing + both profile rows in one round trip — what every public matchup surface needs. */
export async function getPairingWithProfiles(
  db: Db,
  id: string,
): Promise<PairingWithProfiles | null> {
  const pairing = await getPairingById(db, id);
  if (!pairing) return null;
  const [profileA, profileB] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, pairing.profileAId)).limit(1),
    db.select().from(profiles).where(eq(profiles.id, pairing.profileBId)).limit(1),
  ]);
  if (!profileA[0] || !profileB[0]) return null;
  return { pairing, profileA: profileA[0], profileB: profileB[0] };
}

// --- Scoreboard questions (§9.2 `GET /pairings/*`, §9.3 masking) --------------------------------

export interface PairingScoreboardQuestionRow {
  questionId: string;
  slug: string;
  kind: QuestionKind;
  questionDate: string | null;
  /** Never sent to the client as-is — only used by the caller to decide §9.3 lock-masking. */
  lockAt: Date;
  /** `questions.status` — the caller uses this (+ `kind`) for the §6.5 publication-masking rule
   * (a `daily` pick's result stays hidden until `revealed`/`voided`, independent of §9.3's
   * lock-based masking of the pick as a whole). */
  questionStatus: string;
  aPick: { side: MarketSide; result: PickResult } | null;
  bPick: { side: MarketSide; result: PickResult } | null;
}

/**
 * The full shared-question set for a pairing's public scoreboard (§8.8: the week's derived
 * dailies UNION the pairing's `nemesis_bonus` questions), each with the display metadata
 * (`slug`/`kind`/`question_date`/`lock_at`/`status`) `getFullPairingSharedQuestionPicks`
 * (this file's sibling in `nemesis.ts`, WS5-T1/WS5-T3 scoring input) intentionally omits —
 * that function only returns the numeric win/edge shape `scoreNemesisWeek` needs. This one is
 * for the PUBLIC-FACING scoreboard (`pairingScoreboardRowSchema`), which additionally needs
 * each side's chosen `side` (not just win/loss) and enough question metadata to mask correctly
 * (§9.3: masked until `lock_at`; §6.5: a `daily` result stays `pending` until revealed/voided).
 * Both sides' picks are returned UNMASKED (raw) — masking is the caller's job
 * (`apps/web/lib/nemesis/masking.ts`'s `toScoreboardRow`), so this stays a pure data-access
 * helper (§4.3).
 */
export async function getPairingScoreboardQuestions(
  db: Db,
  pairing: { id: string; weekStart: string; weekEnd: string },
  profileAId: string,
  profileBId: string,
): Promise<PairingScoreboardQuestionRow[]> {
  const rows = await db.execute(sql`
    SELECT
      q.id AS question_id,
      q.slug AS slug,
      q.kind AS kind,
      q.question_date AS question_date,
      q.lock_at AS lock_at,
      q.status AS status,
      pk.profile_id AS pick_profile_id,
      pk.side AS pick_side,
      pk.result AS pick_result
    FROM questions q
    LEFT JOIN picks pk
      ON pk.question_id = q.id AND pk.profile_id IN (${profileAId}, ${profileBId})
    WHERE
      (q.kind = 'daily' AND q.question_date BETWEEN ${pairing.weekStart}::date AND ${pairing.weekEnd}::date)
      OR q.id IN (SELECT question_id FROM pairing_questions WHERE pairing_id = ${pairing.id})
    ORDER BY q.question_date ASC NULLS LAST, q.lock_at ASC
  `);

  const byQuestion = new Map<string, PairingScoreboardQuestionRow>();
  const order: string[] = [];
  for (const row of rows.rows) {
    const questionId = row['question_id'] as string;
    let existing = byQuestion.get(questionId);
    if (!existing) {
      existing = {
        questionId,
        slug: row['slug'] as string,
        kind: row['kind'] as QuestionKind,
        questionDate: (row['question_date'] as string | null) ?? null,
        lockAt: new Date(row['lock_at'] as string),
        questionStatus: row['status'] as string,
        aPick: null,
        bPick: null,
      };
      byQuestion.set(questionId, existing);
      order.push(questionId);
    }
    const pickProfileId = row['pick_profile_id'] as string | null;
    if (pickProfileId === profileAId) {
      existing.aPick = { side: row['pick_side'] as MarketSide, result: row['pick_result'] as PickResult };
    } else if (pickProfileId === profileBId) {
      existing.bPick = { side: row['pick_side'] as MarketSide, result: row['pick_result'] as PickResult };
    }
  }
  return order.map((id) => byQuestion.get(id)!);
}

// --- Lifetime history (§9.2 `GET /me/nemesis-history`) ------------------------------------------

export interface NemesisHistoryRow {
  pairingId: string;
  seasonId: string;
  weekStart: string;
  isRematch: boolean;
  /** Narrowed by the WHERE clause below to only these two — `completed`/`cancelled` are the only
   * terminal pairing statuses (§5.7); `scheduled`/`active` pairings are not history yet. */
  status: 'completed' | 'cancelled';
  winnerProfileId: string | null;
  myScore: number;
  theirScore: number;
  opponent: { profileId: string; handle: string; slug: string };
}

/**
 * Every terminal (`completed`/`cancelled`) pairing involving `profileId`, newest week first —
 * the full lifetime record `GET /me/nemesis-history` (§9.2) paginates over. `scheduled`/`active`
 * pairings are deliberately excluded (that's `GET /pairings/current`'s job, not history's).
 * Ordered `(weekStart, id)` desc for a stable keyset the caller can cursor over — a profile has
 * at most one pairing per week (§5.5 unique constraint), so `weekStart` alone would almost
 * always be enough, but `id` breaks any theoretical tie deterministically.
 */
export async function listNemesisHistoryForProfile(db: Db, profileId: string): Promise<NemesisHistoryRow[]> {
  const rows = await db
    .select({
      pairingId: nemesisPairings.id,
      seasonId: nemesisPairings.seasonId,
      weekStart: nemesisPairings.weekStart,
      isRematch: nemesisPairings.isRematch,
      status: nemesisPairings.status,
      winnerProfileId: nemesisPairings.winnerProfileId,
      profileAId: nemesisPairings.profileAId,
      profileBId: nemesisPairings.profileBId,
      scoreA: nemesisPairings.scoreA,
      scoreB: nemesisPairings.scoreB,
    })
    .from(nemesisPairings)
    .where(
      and(
        inArray(nemesisPairings.status, ['completed', 'cancelled']),
        or(eq(nemesisPairings.profileAId, profileId), eq(nemesisPairings.profileBId, profileId)),
      ),
    )
    .orderBy(desc(nemesisPairings.weekStart), desc(nemesisPairings.id));

  if (rows.length === 0) return [];

  const opponentIds = [...new Set(rows.map((r) => (r.profileAId === profileId ? r.profileBId : r.profileAId)))];
  const opponents = await db
    .select({ id: profiles.id, handle: profiles.handle, slug: profiles.slug })
    .from(profiles)
    .where(inArray(profiles.id, opponentIds));
  const byId = new Map(opponents.map((o) => [o.id, o]));

  return rows.map((r) => {
    const isA = r.profileAId === profileId;
    const opponentId = isA ? r.profileBId : r.profileAId;
    const opponent = byId.get(opponentId);
    return {
      pairingId: r.pairingId,
      seasonId: r.seasonId,
      weekStart: r.weekStart,
      isRematch: r.isRematch,
      status: r.status as 'completed' | 'cancelled',
      winnerProfileId: r.winnerProfileId,
      myScore: isA ? r.scoreA : r.scoreB,
      theirScore: isA ? r.scoreB : r.scoreA,
      // Profiles are never hard-deleted (§11.4), so `opponent` should always resolve — the
      // fallback keeps this function total rather than throwing on a data anomaly.
      opponent: opponent
        ? { profileId: opponent.id, handle: opponent.handle, slug: opponent.slug }
        : { profileId: opponentId, handle: opponentId, slug: opponentId },
    };
  });
}

// --- Pairing reactions (SW10-T4, wiring-gaps doc §4 — preset stamp "trash talk") --------------

export type PairingReactionRow = typeof pairingReactions.$inferSelect;

export interface UpsertPairingReactionInput {
  pairingId: string;
  profileId: string;
  emoji: string;
  /** ET calendar day (`etDateString`) — the "per day" unit `pairing_reactions`' unique index
   * enforces. Computed by the caller (`apps/web/lib/nemesis/reactions.ts`), not here, so this
   * stays a pure data-access function with no wall-clock dependency (§4.3). */
  reactionDate: string;
}

/**
 * One stamp per player per day: a same-day repost REPLACES the existing row (updates `emoji`)
 * rather than toggling or erroring — see `createReactionResponseSchema`'s `'replaced'` state
 * doc comment (`@receipts/core`) for why replace was chosen over a 409. Read-then-write inside
 * a transaction rather than a single `ON CONFLICT DO UPDATE` so the caller can distinguish
 * "added" from "replaced" for the response envelope; the table's own unique index
 * (`pairing_reactions_pairing_profile_date_uq`) is still the actual race guard — a concurrent
 * duplicate insert fails the unique constraint and the caller's transaction retries are not
 * needed because `POST /reactions`' per-profile-per-day access pattern makes a genuine race
 * exceedingly rare (same posture as `insertBlock`'s idempotent-conflict handling, this file's
 * neighbor in `moderation.ts`).
 */
export async function upsertPairingReaction(
  db: Db,
  input: UpsertPairingReactionInput,
  at: Date,
): Promise<{ state: 'added' | 'replaced'; row: PairingReactionRow }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(pairingReactions)
      .where(
        and(
          eq(pairingReactions.pairingId, input.pairingId),
          eq(pairingReactions.profileId, input.profileId),
          eq(pairingReactions.reactionDate, input.reactionDate),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(pairingReactions)
        .set({ emoji: input.emoji, updatedAt: at })
        .where(eq(pairingReactions.id, existing.id))
        .returning();
      if (!updated) throw new Error('upsertPairingReaction: update returned no row');
      return { state: 'replaced' as const, row: updated };
    }

    const [inserted] = await tx
      .insert(pairingReactions)
      .values({
        id: uuidv7(),
        pairingId: input.pairingId,
        profileId: input.profileId,
        emoji: input.emoji,
        reactionDate: input.reactionDate,
        updatedAt: at,
      })
      .returning();
    if (!inserted) throw new Error('upsertPairingReaction: insert returned no row');
    return { state: 'added' as const, row: inserted };
  });
}

/**
 * Today's per-player stamps for a pairing's public payload (§9.2 `pairingPublicSchema.
 * today_reactions`) — at most 2 rows (one per participant). Callers are responsible for the
 * §14.3 block-severance check (`areProfilesBlocked`, `moderation.ts`) — this stays a pure,
 * block-unaware data-access function, same split as `getPairingScoreboardQuestions`/
 * `toScoreboardRow`'s masking-is-the-caller's-job convention.
 */
export async function getTodayPairingReactions(
  db: Db,
  pairingId: string,
  reactionDate: string,
): Promise<Array<{ profileId: string; emoji: string }>> {
  return db
    .select({ profileId: pairingReactions.profileId, emoji: pairingReactions.emoji })
    .from(pairingReactions)
    .where(and(eq(pairingReactions.pairingId, pairingId), eq(pairingReactions.reactionDate, reactionDate)));
}
