/**
 * Real DB-backed nemesis matchup + history service (design doc §9.2 `GET /pairings/current`,
 * `GET /pairings/:id`, `GET /me/nemesis-history`; §9.3 masking rules; WS5-T4).
 *
 * This is the real implementation `apps/web/lib/nemesis/mock-api.ts`'s header always pointed
 * at ("When WS5-T4 ships, callers of this module should swap these calls for real `fetch()`s
 * returning the same schema-shaped JSON"): every function here returns exactly the
 * `@receipts/core` response shapes the mock already produced (and the already-shipped WS7-T6
 * UI already renders), assembled from real Postgres reads instead of an in-memory fixture.
 * `apps/web/lib/nemesis/masking.ts`'s `toScoreboardRow` (§9.3 lock-masking) is reused as-is —
 * it was written mock-agnostic for exactly this handoff.
 *
 * SPEC-GAP(ws5-t4): `pairingPublicSchema.narrative_line` is always `null` from this real
 * service. The only narration the engine produces (`packages/engine/src/narration.ts`'s
 * `nemesis_verdict_win`/`_loss`/`_draw` beats, written per-profile into
 * `nemesis_pairings.verdict.narration` by `nemesis:conclude`) is second-person / viewer-
 * anchored ("You read the week better than X...") — there is no neutral, handle-vs-handle
 * variant suitable for this route's viewer-free public payload (§9.1 auth:none, INV-10). The
 * mock's `PAST_PAIRING_NARRATIVE` fixture strings were hand-authored to *look like* real
 * narration output for UI development; nothing in §13.3 specs a third neutral variant to
 * derive programmatically. `NemesisMatchupCard` already renders `narrative_line: null`
 * gracefully (it's conditionally rendered), so this is a safe, non-breaking gap — flagged here
 * rather than inventing new pinned copy outside `copy.ts`/the beat catalog (§10.6).
 */
import { addDaysToDateString, PAGINATION_MAX_LIMIT } from '@receipts/core';
import { getNemesisHistoryResponseSchema, getPairingResponseSchema, nemesisHistoryEntrySchema } from '@receipts/core';
import type { z } from 'zod';
import {
  findActivePairingInvolving,
  getPairingScoreboardQuestions,
  getPairingWithProfiles,
  getProfileById,
  getProfileBySlug,
  getRatingByProfileId,
  listNemesisHistoryForProfile,
  type Db,
  type NemesisPairingRow,
  type PairingScoreboardQuestionRow,
  type ProfileRow,
} from '@receipts/db';
import { isPubliclyResolved } from '@/lib/profile-page';
import { toScoreboardRow, type SharedQuestionRecord } from './masking';
import type { PairingPublic, PairingSide } from './types';

// --- scoreboard assembly (§9.3 masking) ----------------------------------------------------------

type RawPick = NonNullable<PairingScoreboardQuestionRow['aPick']>;

function maskedPick(pick: RawPick | null, question: { kind: string; status: string }): RawPick | null {
  if (!pick) return null;
  if (!isPubliclyResolved(question)) {
    // §6.5 publication rule: a `daily` question's result stays `pending` until revealed/voided,
    // independent of §9.3's separate lock-based masking below. The SIDE is still shown once
    // locked (the crowd split itself becomes public at lock, §9.3) — only the win/loss verdict
    // is held back.
    return { side: pick.side, result: 'pending' };
  }
  return pick;
}

function toSharedQuestionRecord(row: PairingScoreboardQuestionRow): SharedQuestionRecord {
  const questionMeta = { kind: row.kind, status: row.questionStatus };
  return {
    question_id: row.questionId,
    slug: row.slug,
    kind: row.kind,
    question_date: row.questionDate,
    lock_at: row.lockAt.toISOString(),
    a: maskedPick(row.aPick, questionMeta),
    b: maskedPick(row.bPick, questionMeta),
  };
}

/** Assembles the full public `pairingPublicSchema` shape for one pairing (§9.2). */
export async function buildPairingPublic(
  db: Db,
  pairing: NemesisPairingRow,
  profileA: ProfileRow,
  profileB: ProfileRow,
  at: Date,
): Promise<PairingPublic> {
  const weekEnd = addDaysToDateString(pairing.weekStart, 6);
  const questions = await getPairingScoreboardQuestions(
    db,
    { id: pairing.id, weekStart: pairing.weekStart, weekEnd },
    pairing.profileAId,
    pairing.profileBId,
  );
  const scoreboard = questions.map((row) => toScoreboardRow(toSharedQuestionRecord(row), at));

  return getPairingResponseSchema.parse({
    id: pairing.id,
    season_id: pairing.seasonId,
    week_start: pairing.weekStart,
    status: pairing.status,
    is_rematch: pairing.isRematch,
    a: { profile_id: profileA.id, handle: profileA.handle, slug: profileA.slug },
    b: { profile_id: profileB.id, handle: profileB.handle, slug: profileB.slug },
    score: { a: pairing.scoreA, b: pairing.scoreB },
    winner_profile_id: pairing.winnerProfileId,
    narrative_line: null, // SPEC-GAP(ws5-t4) — see file header.
    scoreboard,
  });
}

/** `GET /pairings/:id` (none) — public matchup page data. `null` for an unknown id (404). */
export async function getPairingPublicById(db: Db, pairingId: string, at: Date): Promise<PairingPublic | null> {
  const found = await getPairingWithProfiles(db, pairingId);
  if (!found) return null;
  return buildPairingPublic(db, found.pairing, found.profileA, found.profileB, at);
}

/** `GET /pairings/current` (claimed) — the viewer's active pairing this week, or `null`. */
export async function getCurrentPairingForProfile(
  db: Db,
  profileId: string,
  at: Date,
): Promise<PairingPublic | null> {
  const pairing = await findActivePairingInvolving(db, profileId);
  if (!pairing) return null;
  const [profileA, profileB] = await Promise.all([
    getProfileById(db, pairing.profileAId),
    getProfileById(db, pairing.profileBId),
  ]);
  // Shouldn't happen (profiles are never hard-deleted, §11.4) but keeps this function total.
  if (!profileA || !profileB) return null;
  return buildPairingPublic(db, pairing, profileA, profileB, at);
}

// --- profile ref + rating composition (mirrors mock's `getProfileRef`, §9.2 `GET /profiles/:slug`) --

/**
 * `PairingSide` (`ProfileRef` + rating) for one side of a matchup, by slug — the composition
 * `NemesisMatchupCard` needs (`pairingPublicSchema.a`/`.b` are handle+slug only, no rating;
 * see `./types.ts`'s header for why this stays a UI-side composition rather than a schema
 * field). `null` for an unknown slug — callers fall back to the pairing's own `ProfileRef`
 * with `rating: null` rather than failing the whole page (mirrors the mock's fallback).
 */
export async function getPairingSideRef(db: Db, slug: string): Promise<PairingSide | null> {
  const profile = await getProfileBySlug(db, slug);
  if (!profile) return null;
  const rating = await getRatingByProfileId(db, profile.id);
  return {
    profile_id: profile.id,
    handle: profile.handle,
    slug: profile.slug,
    rating: rating
      ? {
          glicko_rating: rating.glickoRating,
          glicko_rd: rating.glickoRd,
          games_count: rating.gamesCount,
          accuracy_percentile: rating.accuracyPercentile,
        }
      : null,
  };
}

// --- history (§9.2 `GET /me/nemesis-history`) ----------------------------------------------------

export const NEMESIS_HISTORY_DEFAULT_LIMIT = 20;

interface HistoryCursor {
  weekStart: string;
  pairingId: string;
}

/**
 * Cursor = the last-seen entry's `(week_start, pairing_id)` — a stable keyset over
 * `listNemesisHistoryForProfile`'s already-sorted output, immune to the page shifting under a
 * newly-concluded pairing landing at the top mid-pagination (unlike a plain offset cursor).
 */
function encodeHistoryCursor(c: HistoryCursor): string {
  return Buffer.from(`${c.weekStart}|${c.pairingId}`, 'utf8').toString('base64url');
}

function decodeHistoryCursor(raw: string | null | undefined): HistoryCursor | null {
  if (!raw) return null;
  try {
    const [weekStart, pairingId] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!weekStart || !pairingId) return null;
    return { weekStart, pairingId };
  } catch {
    return null;
  }
}

export interface NemesisHistoryQuery {
  cursor?: string | null;
  limit?: number;
}

/** `GET /me/nemesis-history` (claimed) — the viewer's lifetime record vs past nemeses. */
export async function getNemesisHistoryPage(
  db: Db,
  profileId: string,
  query: NemesisHistoryQuery,
): Promise<z.infer<typeof getNemesisHistoryResponseSchema>> {
  const limit = Math.min(query.limit ?? NEMESIS_HISTORY_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT);
  const all = await listNemesisHistoryForProfile(db, profileId);

  const cursor = decodeHistoryCursor(query.cursor);
  let startIndex = 0;
  if (cursor) {
    const idx = all.findIndex((r) => r.weekStart === cursor.weekStart && r.pairingId === cursor.pairingId);
    // An unrecognized/stale cursor yields no further results rather than restarting from the
    // top (which would silently re-serve already-seen rows to the caller).
    startIndex = idx === -1 ? all.length : idx + 1;
  }
  const page = all.slice(startIndex, startIndex + limit);
  const last = page.at(-1);
  const nextCursor =
    last && startIndex + page.length < all.length
      ? encodeHistoryCursor({ weekStart: last.weekStart, pairingId: last.pairingId })
      : null;

  const data = page.map((r) =>
    nemesisHistoryEntrySchema.parse({
      pairing_id: r.pairingId,
      season_id: r.seasonId,
      week_start: r.weekStart,
      opponent: {
        profile_id: r.opponent.profileId,
        handle: r.opponent.handle,
        slug: r.opponent.slug,
      },
      my_score: r.myScore,
      their_score: r.theirScore,
      outcome:
        r.status === 'cancelled' ? 'cancelled' : r.winnerProfileId === null ? 'draw' : r.winnerProfileId === profileId ? 'win' : 'loss',
      is_rematch: r.isRematch,
    }),
  );

  return getNemesisHistoryResponseSchema.parse({ data, meta: { next_cursor: nextCursor } });
}
