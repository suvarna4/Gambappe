/**
 * Per-template entity loaders for `/api/og/*` (design doc §10.5): fetch the entity a template
 * needs, and compute its canonical `?v=` state hash from exactly the fields the render
 * function reads — anything not included here can change without busting the cached image
 * (acceptable only for fields the template never displays); anything included busts the
 * cache the instant it changes (§10.5 "content-addressed").
 *
 * Each loader returns `null` when the entity doesn't exist — routes turn that into the
 * spec'd 404 ("Entity must exist", §10.5) before ever touching the `?v=` guard.
 */
import {
  type Db,
  getDuoWithProfiles,
  getMarketById,
  getPairingWithProfiles,
  getPickById,
  getProfileById,
  getProfileBySlug,
  getProfilePickRecord,
  getQuestionById,
  getQuestionBySlug,
  type DuoWithProfiles,
  type PairingWithProfiles,
  type PickRow,
  type ProfileRow,
  type ProfilePickRecord,
  type QuestionRow,
} from '@receipts/db';
import { ogStateHash } from './hash';

export interface QuestionOgData {
  question: QuestionRow;
  /** Live venue yes-price (§9.2: "shown even while open" — lives on `markets`, not
   * `questions`; joined by `question.market_id`). Null if the market row is somehow missing. */
  yesPrice: number | null;
  /** `question` (pre-lock) vs `result` (revealed) vs `voided` — §10.5 template selection. */
  variant: 'question' | 'result' | 'voided';
}

/**
 * The question OG/card `?v=` state hash, from already-loaded rows. Split out of `loadQuestionOg`
 * so `reveal-payload.ts` (which has the question + market in hand on the hot reveal path) can
 * mint canonical share URLs without a second question/market fetch — one field list, not two
 * hash builders that could drift out of sync with the route's guard.
 */
export function questionOgHash(question: QuestionRow, yesPrice: number | null): string {
  return ogStateHash([
    question.id,
    question.status,
    question.headline,
    yesPrice,
    question.crowdYesAtLock,
    question.crowdNoAtLock,
    question.outcome,
    question.revealedAt?.toISOString() ?? null,
    question.voidReason,
  ]);
}

export async function loadQuestionOg(
  db: Db,
  slug: string,
): Promise<{ data: QuestionOgData; hash: string } | null> {
  const question = await getQuestionBySlug(db, slug);
  if (!question) return null;
  const market = await getMarketById(db, question.marketId);
  const yesPrice = market?.yesPrice ?? null;

  const variant: QuestionOgData['variant'] =
    question.status === 'revealed' ? 'result' : question.status === 'voided' ? 'voided' : 'question';

  return { data: { question, yesPrice, variant }, hash: questionOgHash(question, yesPrice) };
}

export interface ReceiptOgData {
  pick: PickRow;
  question: QuestionRow;
  profile: ProfileRow;
  /** Best-effort — see SPEC-GAP note at the call site (route handler). */
  variant: 'win' | 'loss' | 'void' | 'busted_streak';
}

export async function loadReceiptOg(
  db: Db,
  pickId: string,
): Promise<{ data: ReceiptOgData; hash: string } | null> {
  const pick = await getPickById(db, pickId);
  if (!pick) return null;
  const [question, profile] = await Promise.all([
    getQuestionById(db, pick.questionId),
    getProfileById(db, pick.profileId),
  ]);
  if (!question || !profile) return null;

  // SPEC-GAP(WS8-T1): "busted-streak" is a best-effort read of *current* streak state, not a
  // proven binding of "this pick broke it" (that needs the §6.6 replay's date-ordered walk,
  // WS3-T3 scope). Shown only when the pick lost AND the profile's streak is presently zero
  // despite having had one — close enough for a shareable loss card, not exact provenance.
  const variant: ReceiptOgData['variant'] =
    pick.result === 'win'
      ? 'win'
      : pick.result === 'void'
        ? 'void'
        : pick.result === 'loss' && profile.currentStreak === 0 && profile.bestStreak >= 1
          ? 'busted_streak'
          : 'loss';

  const hash = ogStateHash([
    pick.id,
    pick.result,
    pick.edge,
    pick.side,
    pick.yesPriceAtEntry,
    profile.currentStreak,
    profile.bestStreak,
    question.outcome,
  ]);

  return { data: { pick, question, profile, variant }, hash };
}

export async function loadMatchupOg(
  db: Db,
  pairingId: string,
): Promise<{ data: PairingWithProfiles; hash: string } | null> {
  const data = await getPairingWithProfiles(db, pairingId);
  if (!data) return null;

  const hash = ogStateHash([
    data.pairing.id,
    data.pairing.status,
    data.pairing.scoreA,
    data.pairing.scoreB,
    data.pairing.winnerProfileId,
  ]);

  return { data, hash };
}

export interface ProfileOgData {
  profile: ProfileRow;
  record: ProfilePickRecord;
}

export async function loadProfileOg(
  db: Db,
  slug: string,
): Promise<{ data: ProfileOgData; hash: string } | null> {
  const profile = await getProfileBySlug(db, slug);
  if (!profile) return null;
  const record = await getProfilePickRecord(db, profile.id);

  const hash = ogStateHash([
    profile.id,
    profile.handle,
    profile.currentStreak,
    profile.bestStreak,
    profile.currentWinStreak,
    profile.bestWinStreak,
    record.wins,
    record.losses,
    record.voids,
  ]);

  return { data: { profile, record }, hash };
}

export async function loadDuoOg(
  db: Db,
  duoId: string,
): Promise<{ data: DuoWithProfiles; hash: string } | null> {
  const data = await getDuoWithProfiles(db, duoId);
  if (!data) return null;

  const hash = ogStateHash([
    data.duo.id,
    data.duo.status,
    data.duo.tier,
    data.duo.matchesPlayed,
    data.duo.glickoRating,
    data.duo.synergy,
  ]);

  return { data, hash };
}
