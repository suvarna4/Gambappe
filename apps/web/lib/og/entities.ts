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
  getFreezeUsesForProfile,
  getMarketById,
  getPairingWithProfiles,
  getPickById,
  getPicksForProfile,
  getProfileById,
  getProfileBySlug,
  getProfilePickRecord,
  getQuestionById,
  getQuestionBySlug,
  listAllRevealedOrVoidedDaily,
  replayStreak,
  type CompletedStreakRun,
  type DuoWithProfiles,
  type PairingWithProfiles,
  type PickRow,
  type ProfileRow,
  type ProfilePickRecord,
  type QuestionRow,
} from '@receipts/db';
import { OBITUARY_MIN_STREAK } from '@receipts/ui';
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
  variant: 'win' | 'loss' | 'void' | 'busted_streak';
  /**
   * Non-null iff `variant === 'busted_streak'`: the completed run this pick was the final
   * answered pick of (SW9-T3) — feeds the obituary layout its REAL length and b./d. dates,
   * never a live-profile-field guess.
   */
  bustedRun: CompletedStreakRun | null;
}

/**
 * SW9-T3 (obituary-handoff §3.3(2)): the honest busted-streak binding. This pick mints the
 * tombstone iff it is the FINAL ANSWERED pick of a COMPLETED (broken) participation run of
 * length ≥ `OBITUARY_MIN_STREAK` — derived from the §6.6 full-history replay's `runs`, the
 * same primitive the reveal's `broken_run` block uses, so card and wake can never disagree.
 * Because the replay recomputes from current history on every load, the binding is permanent
 * AND regrade-consistent: voiding/regrading the killer gap day resurrects the run and the
 * card silently reverts to a plain win/loss receipt (§2 "regrade can resurrect the dead").
 *
 * Per §3.1, a run's `endedOn` can be a voided or freeze-covered date the profile never picked,
 * so "final answered pick" means the latest ANSWERED daily ≤ `endedOn` within the run
 * (mirroring `computeBrokenRunBlock`'s resolution in `reveal-payload.ts`, including its
 * `answered` predicate: a pick exists and its result isn't `void`) — never "the pick on
 * `endedOn`". Note this deliberately includes WIN picks: death is by absence, and "Died
 * holding {SIDE} @ {c}¢" is the run's final position, not a loss (§2).
 */
async function resolveBustedRun(
  db: Db,
  pick: PickRow,
  question: QuestionRow,
): Promise<CompletedStreakRun | null> {
  // Only an answered pick on a settled (revealed) daily can sit inside a participation run —
  // bonus questions and voided picks never count toward streaks (§6.6).
  if (question.kind !== 'daily' || question.questionDate === null) return null;
  if (question.status !== 'revealed' || pick.result === 'void') return null;

  const [history, profilePicks, freezeUses] = await Promise.all([
    listAllRevealedOrVoidedDaily(db),
    getPicksForProfile(db, pick.profileId),
    getFreezeUsesForProfile(db, pick.profileId),
  ]);
  const { runs } = replayStreak(history, profilePicks, freezeUses);
  const questionDate = question.questionDate;
  const run = runs.find((r) => r.startedOn <= questionDate && questionDate <= r.endedOn);
  if (!run || run.length < OBITUARY_MIN_STREAK) return null;

  const pickByQuestionId = new Map(profilePicks.map((p) => [p.questionId, p] as const));
  const finalAnswered = history
    .filter(
      (q) =>
        q.status === 'revealed' && q.questionDate >= run.startedOn && q.questionDate <= run.endedOn,
    )
    .sort((a, b) => a.questionDate.localeCompare(b.questionDate))
    .filter((q) => {
      const p = pickByQuestionId.get(q.id);
      return p !== undefined && p.result !== 'void';
    })
    .at(-1);
  return finalAnswered?.id === pick.questionId ? run : null;
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

  // The replay binding outranks the raw result on purpose (SW9-T3 "say it out loud"): a WIN
  // pick that ended a run gets the tombstone as its canonical share card, permanently —
  // including already-circulating links, which the `?v=` guard 302s onto the new render.
  const bustedRun = await resolveBustedRun(db, pick, question);
  const variant: ReceiptOgData['variant'] = bustedRun
    ? 'busted_streak'
    : pick.result === 'win'
      ? 'win'
      : pick.result === 'void'
        ? 'void'
        : 'loss';

  // §10.5 content-addressing: the busted-run binding (and the run fields the obituary layout
  // renders) are hash inputs, so a regrade/void that resurrects or re-kills the run mints a
  // new canonical `?v=` and stale cached tombstones/receipts can never be served as current.
  const hash = ogStateHash([
    pick.id,
    pick.result,
    pick.edge,
    pick.side,
    pick.yesPriceAtEntry,
    profile.currentStreak,
    profile.bestStreak,
    question.outcome,
    variant,
    bustedRun?.length ?? null,
    bustedRun?.startedOn ?? null,
    bustedRun?.endedOn ?? null,
  ]);

  return { data: { pick, question, profile, variant, bustedRun }, hash };
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
