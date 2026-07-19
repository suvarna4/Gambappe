/**
 * Public profile page/API service layer (design doc §9.2 `GET /profiles/:slug`,
 * `GET /profiles/:slug/picks`, §6.1.2 slug addressing, §6.5 publication rule, §9.3 masking,
 * WS7-T4). Both the JSON route handlers and the `/p/[slug]` server component call into this
 * module so the API contract and the SSR page render the exact same underlying picture
 * (§4.3: business logic lives in `apps/web/lib`, not inline in route files or duplicated
 * between the two entry points).
 *
 * A `deleted` profile (or a slug with no row at all) resolves to `null` everywhere here —
 * callers turn that into a 404 (WS7-T4 AC).
 */
import type { z } from 'zod';
import {
  LONGSHOT_THRESHOLD,
  type MarketCategory,
  type PickResult,
  profileSettingsSchema,
  type fingerprintSummarySchema,
  type pickPublicSchema,
  type profilePublicSchema,
} from '@receipts/core';
import {
  getActiveWalletLinkByProfileId,
  getFingerprintRow,
  getNemesisSummaryForProfile,
  getProfileBySlug,
  getRatingByProfileId,
  hasCalledItPick,
  listPublicPicksForProfile,
  type Db,
  type FingerprintRow,
  type NemesisSummary,
  type ProfilePickWithQuestion,
  type ProfilePicksCursor,
  type ProfileRow,
  type RatingRow,
} from '@receipts/db';
// WS12's exhaustive wallet public-display allowlist (§12.4/§12.5) — its own doc comment asks
// GET /profiles/:slug to call this rather than hand-rolling a second wallet projection.
import { toWalletBadge, type WalletBadge } from '@/lib/serialize-wallet';

export type ProfilePublic = z.infer<typeof profilePublicSchema>;
export type PickPublic = z.infer<typeof pickPublicSchema>;
export type FingerprintSummary = z.infer<typeof fingerprintSummarySchema>;
export type { WalletBadge };

/**
 * SPEC-GAP(ws7-t4): Appendix D pins no default/preview page size for the profile pick log —
 * §9.1 only caps the max at `PAGINATION_MAX_LIMIT` (50). These are reasonable implementation
 * defaults, not scored business constants, so they live here rather than in `core/config.ts`.
 */
export const PROFILE_RECENT_PICKS_LIMIT = 10;
export const PROFILE_PICKS_DEFAULT_LIMIT = 20;
export const PROFILE_PAGE_PICKS_PAGE_SIZE = 20;

// --- cursor codec (mirrors the admin market-browser cursor pattern) ---------------------------

export function encodePicksCursor(row: { pickedAt: Date; id: string }): string {
  return Buffer.from(`${row.pickedAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodePicksCursor(raw: string | null | undefined): ProfilePicksCursor | null {
  if (!raw) return null;
  try {
    const [pickedAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!pickedAt || !id) return null;
    return { pickedAt, id };
  } catch {
    return null;
  }
}

// --- §6.5 publication rule / §9.3 masking -------------------------------------------------------

/**
 * A `daily` question's picks stay `pending` on every public surface until the synchronized
 * reveal fires (or the question voids) — grading may already have written `result`/`edge`
 * internally, but nothing observable may change before then (§6.5, §9.3). Bonus questions
 * (`nemesis_bonus`/`duo_bonus`) have no held reveal and publish immediately (§8.8.1).
 *
 * Exported (WS5-T4): the nemesis matchup scoreboard (`apps/web/lib/nemesis/service.ts`) needs
 * this exact same publication rule for a shared question's pick result — reused rather than
 * re-derived to avoid the two masking rules drifting apart.
 */
export function isPubliclyResolved(question: { kind: string; status: string }): boolean {
  if (question.kind !== 'daily') return true;
  return question.status === 'revealed' || question.status === 'voided';
}

function maskedResultAndEdge(row: ProfilePickWithQuestion): {
  result: PickResult;
  edge: number | null;
} {
  if (!isPubliclyResolved(row.question)) {
    return { result: 'pending', edge: null };
  }
  return { result: row.pick.result, edge: row.pick.edge };
}

/** Public `picked_at` is truncated to minute precision (§9.2 — sleep/location profiling guard). */
function truncateToMinuteIso(date: Date): string {
  const ms = date.getTime();
  return new Date(ms - (ms % 60_000)).toISOString();
}

/**
 * Exported so `/p/[slug]/page.tsx` can render the exact same masked (§6.5/§9.3) pick shape
 * the JSON API returns, rather than re-deriving the masking rule against the raw joined row.
 */
export function toPickPublic(row: ProfilePickWithQuestion): PickPublic {
  const { result, edge } = maskedResultAndEdge(row);
  return {
    id: row.pick.id as PickPublic['id'],
    question_id: row.pick.questionId as PickPublic['question_id'],
    profile_id: row.pick.profileId as PickPublic['profile_id'],
    side: row.pick.side,
    yes_price_at_entry: row.pick.yesPriceAtEntry,
    price_stamped_at: row.pick.priceStampedAt.toISOString(),
    picked_at: truncateToMinuteIso(row.pick.pickedAt),
    source: row.pick.source,
    result,
    edge,
  };
}

interface PicksPage {
  data: PickPublic[];
  meta: { next_cursor: string | null };
  rows: ProfilePickWithQuestion[];
}

async function fetchPicksPage(
  db: Db,
  profileId: string,
  cursor: ProfilePicksCursor | null,
  limit: number,
): Promise<PicksPage> {
  const rows = await listPublicPicksForProfile(db, profileId, cursor, limit);
  const last = rows.at(-1);
  const nextCursor =
    last && rows.length === limit
      ? encodePicksCursor({ pickedAt: last.pick.pickedAt, id: last.pick.id })
      : null;
  return { data: rows.map(toPickPublic), meta: { next_cursor: nextCursor }, rows };
}

// --- fingerprint / rating / nemesis / wallet / badges -------------------------------------------

function buildFingerprintSummary(fp: FingerprintRow | null): FingerprintSummary | null {
  if (
    !fp ||
    fp.resolvedPickCount === 0 ||
    fp.chalk === null ||
    fp.contrarian === null ||
    fp.timing === null
  ) {
    return null;
  }
  return {
    resolved_pick_count: fp.resolvedPickCount,
    chalk: fp.chalk,
    contrarian: fp.contrarian,
    timing: fp.timing,
    category_shares: (fp.categoryShares ?? {}) as Record<MarketCategory, number>,
  };
}

function buildRatingBlock(rating: RatingRow | null): ProfilePublic['rating'] {
  if (!rating) return null;
  return {
    glicko_rating: rating.glickoRating,
    glicko_rd: rating.glickoRd,
    games_count: rating.gamesCount,
    accuracy_percentile: rating.accuracyPercentile,
  };
}

/** §12.4/§12.5 exhaustive public display allowlist, via WS12's `toWalletBadge` (see import). */
async function buildWalletBadge(db: Db, profile: ProfileRow): Promise<WalletBadge | null> {
  const link = await getActiveWalletLinkByProfileId(db, profile.id);
  const settings = profileSettingsSchema.parse(profile.settings ?? {});
  return toWalletBadge(link, settings.show_wallet_address);
}

/**
 * SPEC-GAP(ws7-t4): §9.2 lists "badges" on `GET /profiles/:slug` without enumerating a badge
 * catalog beyond the "called it" longshot badge (§6.7 — `result='win'` at an implied entry
 * probability ≤ `LONGSHOT_THRESHOLD`). This derives only `called_it`; a fuller badge system is
 * unspecified product mechanics and intentionally not invented here.
 */
async function buildBadges(db: Db, profileId: string): Promise<string[]> {
  const calledIt = await hasCalledItPick(db, profileId, LONGSHOT_THRESHOLD);
  return calledIt ? ['called_it'] : [];
}

interface ProfileStats {
  fingerprint: FingerprintSummary | null;
  rating: ProfilePublic['rating'];
  nemesisSummary: NemesisSummary;
  wallet: WalletBadge | null;
  badges: string[];
}

async function loadProfileStats(db: Db, profile: ProfileRow): Promise<ProfileStats> {
  const [fingerprintRow, ratingRow, nemesisSummary, wallet, badges] = await Promise.all([
    getFingerprintRow(db, profile.id),
    getRatingByProfileId(db, profile.id),
    getNemesisSummaryForProfile(db, profile.id),
    buildWalletBadge(db, profile),
    buildBadges(db, profile.id),
  ]);
  return {
    fingerprint: buildFingerprintSummary(fingerprintRow),
    rating: buildRatingBlock(ratingRow),
    nemesisSummary,
    wallet,
    badges,
  };
}

/** `status='deleted'` (or no row at all) resolves to `null` — 404 territory, never an error. */
async function getVisibleProfileBySlug(db: Db, slug: string): Promise<ProfileRow | null> {
  const profile = await getProfileBySlug(db, slug);
  if (!profile || profile.status === 'deleted') return null;
  return profile;
}

// --- public entry points -------------------------------------------------------------------

/** `GET /api/v1/profiles/:slug` (§9.2). */
export async function getProfilePublicView(db: Db, slug: string): Promise<ProfilePublic | null> {
  const profile = await getVisibleProfileBySlug(db, slug);
  if (!profile) return null;

  const [stats, picksPage] = await Promise.all([
    loadProfileStats(db, profile),
    fetchPicksPage(db, profile.id, null, PROFILE_RECENT_PICKS_LIMIT),
  ]);

  return {
    profile_id: profile.id as ProfilePublic['profile_id'],
    handle: profile.handle,
    slug: profile.slug,
    kind: profile.kind,
    created_at: profile.createdAt.toISOString(),
    streak: { current: profile.currentStreak, best: profile.bestStreak },
    win_streak: { current: profile.currentWinStreak, best: profile.bestWinStreak },
    rating: stats.rating,
    fingerprint: stats.fingerprint,
    badges: stats.badges,
    wallet: stats.wallet,
    nemesis_summary: stats.nemesisSummary,
    recent_picks: { data: picksPage.data, meta: picksPage.meta },
  };
}

/** `GET /api/v1/profiles/:slug/picks` (§9.2, cursor pagination per §9.1). */
export async function getProfilePicksResponse(
  db: Db,
  slug: string,
  cursor: string | null | undefined,
  limit: number,
): Promise<{ data: PickPublic[]; meta: { next_cursor: string | null } } | null> {
  const profile = await getVisibleProfileBySlug(db, slug);
  if (!profile) return null;

  const page = await fetchPicksPage(db, profile.id, decodePicksCursor(cursor), limit);
  return { data: page.data, meta: page.meta };
}

/** Everything `/p/[slug]` needs to render a page (§10.1–§10.2) — the joined question fields
 * (headline, side labels) the JSON pick log intentionally omits are used here for display only. */
export interface ProfilePageModel {
  profile: ProfileRow;
  stats: ProfileStats;
  picks: ProfilePickWithQuestion[];
  nextCursor: string | null;
}

export async function getProfilePageModel(
  db: Db,
  slug: string,
  cursor: string | null | undefined,
): Promise<ProfilePageModel | null> {
  const profile = await getVisibleProfileBySlug(db, slug);
  if (!profile) return null;

  const [stats, picksPage] = await Promise.all([
    loadProfileStats(db, profile),
    fetchPicksPage(db, profile.id, decodePicksCursor(cursor), PROFILE_PAGE_PICKS_PAGE_SIZE),
  ]);

  return { profile, stats, picks: picksPage.rows, nextCursor: picksPage.meta.next_cursor };
}
