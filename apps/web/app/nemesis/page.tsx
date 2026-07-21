import { redirect } from 'next/navigation';
import { NEMESIS_MIN_PICKS, now } from '@receipts/core';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../auth';
import { NemesisAssignmentCard } from '@/components/nemesis/NemesisAssignmentCard';
import { NemesisHeadToHeadBanner } from '@/components/nemesis/NemesisHeadToHeadBanner';
import { RematchPanel, type RematchVerdict } from '@/components/nemesis/RematchPanel';
import type { DayResult } from '@/components/nemesis/VerdictCard';
import { selectNemesisPageState } from '@/lib/nemesis/page-state';
import { deriveDayResults, scoreMarginFromHistory, verdictOutcomeFromHistory } from '@/lib/nemesis/verdict';
import {
  getCurrentPairingForProfile,
  getNemesisHistoryPage,
  getPairingPublicById,
  getPairingSideRef,
  NEMESIS_HISTORY_DEFAULT_LIMIT,
} from '@/lib/nemesis/service';
import { getDb } from '@/lib/stores';
import type { PairingSide } from '@/lib/nemesis/types';

/**
 * `/nemesis` — the claimed viewer's own nemesis hub (design doc §19.3 WS7-T6 deliverables:
 * "Assignment reveal card, matchup page, history").
 *
 * Not in the design doc's §10.1 route table (only `/vs/[pairingId]` is listed there) — this
 * route was WS7-T6's own addition, documented in its PR description rather than silently
 * invented. Rationale: `GET /pairings/current`, `GET /me/nemesis-history`, and
 * `POST /rematch-requests*` are all `claimed`-auth endpoints (§9.2) with no viewer-specific
 * data allowed on the public `/vs/[pairingId]` route (INV-10) — they need a private home.
 *
 * Design-diff audit (structural redesign): this page used to STACK the compact assignment card,
 * the FULL `NemesisMatchupCard` (duplicating `/vs/[pairingId]`), and the entire history list —
 * with no distinct "week just settled, make your decision" moment (a completed week only ever
 * appeared as one compact row buried in the aggregate list). It's now a state machine
 * (`selectNemesisPageState`, `@/lib/nemesis/page-state`) showing exactly ONE of three states,
 * matching the mockup's three distinct nemesis-week moments (`docs/mockups/swipe-ux.html`
 * "04 NEMESIS"):
 *   - `assignment`: the redesigned `NemesisAssignmentCard` only — the full matchup now lives at
 *     the new private `/nemesis/matchup` route (see that file's header for why `/vs/[pairingId]`
 *     itself can't carry this, INV-10).
 *   - `verdict`: the most recent settled week's `NemesisHeadToHeadBanner` + swipeable
 *     `RematchPanel`/`VerdictCard` close, promoted OUT of the history list into primary content
 *     (mirrors the mockup's Friday verdict exhibit).
 *   - `empty`: neither of the above — same placeholder copy as before.
 *
 * The aggregate history list (every past pairing, not just the most recent) has its own private
 * `/nemesis/history` route now, same reasoning as the `/nemesis/matchup` split — this page is
 * about the CURRENT nemesis-week moment; a full lifetime list is a distinct, separate concern the
 * mockup doesn't even show on the same exhibit. No on-page link to it (explicit design feedback
 * on an earlier version of this page) — reached directly by URL for now. `getNemesisHistoryPage`
 * is still fetched here (not just on the history route) because `selectNemesisPageState` needs
 * the most recent entry to decide whether to promote it into the `verdict` state above — that's
 * a determination this page still owns, only the LIST RENDERING moved out.
 *
 * WS5-T4: resolves the real viewer via `auth()` + `getProfileByUserId` (mirroring
 * `/claim/page.tsx`'s own direct `auth()` use — no `Request`-argument-free identity resolver
 * exists yet for server components, so this follows that closest existing pattern rather than
 * inventing a new one) and reads real pairing/history data from `@/lib/nemesis/service`.
 *
 * WS5-T5: `RematchPanel` talks to the real `/api/v1/rematch-requests*` endpoints. Each history
 * row's (and the promoted verdict entry's) rematch state is server-rendered here too —
 * `getNemesisHistoryPage` folds it into `entry.rematch_request` (§9.2 contract-change, see
 * `nemesisRematchStateSchema`'s header in `@receipts/core`) — so the panel never needs its own
 * discovery fetch on mount.
 *
 * A ghost (ineligible) or signed-out visitor is redirected to `/claim` — this page has no
 * spectator-safe empty state to fall back to (unlike `/vs/[pairingId]`, which is public by
 * design).
 */
export const dynamic = 'force-dynamic';

export default async function NemesisHomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/claim');

  const db = getDb();
  const profile = await getProfileByUserId(db, session.user.id);
  if (!profile || profile.kind !== 'claimed') redirect('/claim');

  const viewerProfileId = profile.id;
  const at = now();
  const [pairing, historyPage] = await Promise.all([
    getCurrentPairingForProfile(db, viewerProfileId, at),
    getNemesisHistoryPage(db, viewerProfileId, { limit: NEMESIS_HISTORY_DEFAULT_LIMIT }),
  ]);

  const pageState = selectNemesisPageState({ pairing, historyEntries: historyPage.data, at });

  let opponentSide: PairingSide | null = null;
  if (pairing) {
    const opponentRef = pairing.a.profile_id === viewerProfileId ? pairing.b : pairing.a;
    const opponentFull = await getPairingSideRef(db, opponentRef.slug);
    opponentSide = opponentFull ?? {
      profile_id: opponentRef.profile_id,
      handle: opponentRef.handle,
      slug: opponentRef.slug,
      rating: null,
    };
  }

  // Design-diff audit: the assignment card's "THE WEEK" day-count strip (empty dots for the
  // week ahead, no picks landed yet) — real data, not fabricated: `pairing.scoreboard` already
  // carries every shared question for the whole week the moment the pairing exists (masking
  // only nulls the RESULTS, not the rows themselves), so the daily-row count and whether a
  // nemesis_bonus question exists this week are both known on assignment day, before anyone
  // picks.
  const sharedDayCount = pairing ? pairing.scoreboard.filter((row) => row.kind === 'daily').length : 0;
  const hasBonusQuestion = pairing ? pairing.scoreboard.some((row) => row.kind === 'nemesis_bonus') : false;

  const promotedEntry = pageState.kind === 'verdict' ? pageState.entry : null;

  // SW10-T2: the head-to-head banner's day-strip dots come from the promoted entry's own pairing
  // scoreboard (`GET /pairings/:id`, `pairingPublicSchema.scoreboard`) — the history entry itself
  // (`nemesisHistoryEntrySchema`) carries no per-day data. Only fetched for the promoted entry
  // (not every history entry) now that the aggregate list itself lives at `/nemesis/history` —
  // that route derives its own day-results independently for whichever entries it renders.
  // Filtered to `kind === 'daily'` before deriving: `deriveDayResults` itself deliberately
  // INCLUDES the nemesis_bonus row (it counts toward the real score, so the scorer treats it as
  // just another graded row) — but the mockup's "DAYS" strip is specifically a calendar-day
  // count, and a per-week bonus question isn't a day. Filtering here, not in
  // `deriveDayResults`, keeps that function's own score-aligned contract (and its existing
  // tests) intact for whatever else reads it.
  const promotedPairing = promotedEntry ? await getPairingPublicById(db, promotedEntry.pairing_id, at) : null;
  const promotedDayResults: ReadonlyArray<DayResult> =
    promotedEntry && promotedPairing
      ? deriveDayResults(
          promotedPairing.scoreboard.filter((row) => row.kind === 'daily'),
          viewerProfileId,
          promotedPairing,
        )
      : [];

  const promotedVerdict: RematchVerdict | null = promotedEntry
    ? (() => {
        const outcome = verdictOutcomeFromHistory(promotedEntry.outcome);
        // Can't actually happen — `selectNemesisPageState` already excludes `cancelled` entries
        // from ever becoming the promoted one — but keeps this block total rather than asserting.
        if (!outcome) return null;
        return {
          outcome,
          youWins: promotedEntry.my_score,
          opponentWins: promotedEntry.their_score,
          scoreMargin: scoreMarginFromHistory(promotedEntry),
        };
      })()
    : null;

  return (
    <main className="mx-auto max-w-xl space-y-8 px-6 py-10">
      {pageState.kind === 'assignment' && pairing && opponentSide ? (
        <div data-testid="nemesis-assignment-state">
          <NemesisAssignmentCard
            opponent={opponentSide}
            isRematch={pairing.is_rematch}
            weekStart={pairing.week_start}
            sharedDayCount={sharedDayCount}
            hasBonusQuestion={hasBonusQuestion}
          />
        </div>
      ) : null}

      {pageState.kind === 'verdict' && promotedEntry && promotedVerdict ? (
        <div data-testid="nemesis-verdict-state" className="space-y-3">
          <NemesisHeadToHeadBanner
            viewerHandle={profile.handle}
            opponentHandle={promotedEntry.opponent.handle}
            viewerScore={promotedEntry.my_score}
            opponentScore={promotedEntry.their_score}
            outcome={promotedVerdict.outcome}
            weekStart={promotedEntry.week_start}
            dayResults={promotedDayResults}
          />
          <RematchPanel
            viewerProfileId={viewerProfileId}
            opponent={promotedEntry.opponent}
            rematchRequest={
              promotedEntry.rematch_request
                ? {
                    id: promotedEntry.rematch_request.id,
                    direction: promotedEntry.rematch_request.direction,
                    status: promotedEntry.rematch_request.status,
                  }
                : null
            }
            verdict={promotedVerdict}
          />
          {/* Reserves the space `VerdictCard`'s own fixed-to-the-viewport-bottom action row
              occupies, so it never covers this block's own tail content (or the layout's
              footer) once scrolled to the bottom — see that component's header. */}
          <div aria-hidden="true" className="h-20" />
        </div>
      ) : null}

      {pageState.kind === 'empty' ? (
        <p data-testid="nemesis-empty-state" className="text-muted text-sm">
          No active pairing this week — nemesis assignments go out Monday 9am ET once you have{' '}
          {NEMESIS_MIN_PICKS} graded picks.
        </p>
      ) : null}
    </main>
  );
}
