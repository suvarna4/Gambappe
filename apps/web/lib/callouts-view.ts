/**
 * Server-side view helpers for the `/rivals` call-out surfaces (journeys plan §5 WS20-T4, D-J5).
 * Thin read/shape helpers over the already-merged repos — no HTTP self-calls (repo pattern, same
 * posture as `lib/nemesis/service.ts`). The route handlers + business logic for the call-out
 * lifecycle itself live in `lib/callouts.ts` (WS20-T3); this module only assembles what the hub
 * renders.
 */
import { getNemesisHistoryPage, NEMESIS_HISTORY_DEFAULT_LIMIT } from './nemesis/service';
import { getProfileById, listAcceptedCalloutsForProfile, type Db } from '@receipts/db';
import type { NemesisHistoryEntry } from './nemesis/types';

/** A past rival the viewer can call out — one row per distinct opponent, newest week first. */
export interface CalloutCandidate {
  profileId: string;
  handle: string;
  slug: string;
}

/**
 * Distinct rival candidates for the "Call someone out" panel, drawn from the viewer's nemesis
 * history (`GET /me/nemesis-history` data). Deduped by opponent so a rival faced across several
 * weeks appears once. Order follows the history's own recency (newest pairing first).
 */
export async function getCalloutCandidates(db: Db, profileId: string): Promise<CalloutCandidate[]> {
  const page = await getNemesisHistoryPage(db, profileId, { limit: NEMESIS_HISTORY_DEFAULT_LIMIT });
  const seen = new Set<string>();
  const candidates: CalloutCandidate[] = [];
  for (const entry of page.data) {
    const id = entry.opponent.profile_id;
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ profileId: id, handle: entry.opponent.handle, slug: entry.opponent.slug });
  }
  return candidates;
}

/** The "locked in — you face {handle} next week" confirmation both sides' hubs show after accept. */
export interface AcceptedCalloutView {
  calloutId: string;
  opponentHandle: string;
  opponentSlug: string;
}

/**
 * The viewer's accepted call-outs, resolved to the OTHER side for display (journeys plan §5 AC:
 * "both `/rivals` screens show it"). Works for both roles: if the viewer is the challenger, the
 * opponent side is shown; if the viewer accepted, the challenger side is shown. A corrupt row with
 * a missing "other" profile (profiles are never hard-deleted, §11.4) is skipped rather than thrown.
 */
export async function getAcceptedCalloutViews(db: Db, profileId: string): Promise<AcceptedCalloutView[]> {
  const rows = await listAcceptedCalloutsForProfile(db, profileId);
  const views: AcceptedCalloutView[] = [];
  for (const row of rows) {
    const otherId = row.challengerProfileId === profileId ? row.opponentProfileId : row.challengerProfileId;
    if (!otherId) continue; // opponent is set on accept, so this only guards a corrupt row.
    const other = await getProfileById(db, otherId);
    if (!other) continue;
    views.push({ calloutId: row.id, opponentHandle: other.handle, opponentSlug: other.slug });
  }
  return views;
}

/** A lifetime per-rival aggregate for the grudge book (journeys plan §5: "they lead 2–1"). */
export interface GrudgeRecord {
  opponent: { profileId: string; handle: string; slug: string };
  myWins: number;
  theirWins: number;
  draws: number;
  /** Total settled weeks (win/loss/draw; cancelled weeks excluded). */
  weeks: number;
  /** The most recent pairing id vs this rival — the row's "see the matchup" link target. */
  latestPairingId: string;
  /** The most relevant existing rematch request with this rival, if any (incoming-open preferred). */
  rematchRequest: NemesisHistoryEntry['rematch_request'];
}

/**
 * Fold per-week nemesis history entries into one lifetime record per rival (journeys plan §5
 * WS20-T4). Pure (no DB) so it's unit-tested directly. Entries are assumed newest-first (the
 * history page's own order); the first entry seen for a rival is therefore the latest, which is
 * where the row's pairing link and rematch state come from. `cancelled` weeks count toward
 * neither the W/L/D tally nor `weeks` (they never happened as a contest).
 */
export function aggregateGrudges(entries: readonly NemesisHistoryEntry[]): GrudgeRecord[] {
  const byRival = new Map<string, GrudgeRecord>();
  const order: string[] = [];
  for (const entry of entries) {
    const id = entry.opponent.profile_id;
    let rec = byRival.get(id);
    if (!rec) {
      rec = {
        opponent: { profileId: id, handle: entry.opponent.handle, slug: entry.opponent.slug },
        myWins: 0,
        theirWins: 0,
        draws: 0,
        weeks: 0,
        latestPairingId: entry.pairing_id,
        // Newest-first: the first entry seen for a rival carries the freshest rematch state.
        rematchRequest: entry.rematch_request,
      };
      byRival.set(id, rec);
      order.push(id);
    }
    // Prefer an actionable incoming-open request over an older/terminal one, whichever week it's on.
    if (entry.rematch_request?.direction === 'incoming' && entry.rematch_request.status === 'open') {
      rec.rematchRequest = entry.rematch_request;
    }
    if (entry.outcome === 'win') rec.myWins += 1;
    else if (entry.outcome === 'loss') rec.theirWins += 1;
    else if (entry.outcome === 'draw') rec.draws += 1;
    if (entry.outcome !== 'cancelled') rec.weeks += 1;
  }
  return order.map((id) => byRival.get(id)!).filter((rec) => rec.weeks > 0);
}
