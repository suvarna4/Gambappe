import { NEMESIS_MIN_PICKS, now } from '@receipts/core';
import type { ProfileRow } from '@receipts/db';
import { NemesisAssignmentCard } from '@/components/nemesis/NemesisAssignmentCard';
import { NemesisHeadToHeadBanner } from '@/components/nemesis/NemesisHeadToHeadBanner';
import { RematchPanel, type RematchVerdict } from '@/components/nemesis/RematchPanel';
import type { DayResult } from '@/components/nemesis/VerdictCard';
import { selectNemesisPageState } from '@/lib/nemesis/page-state';
import {
  deriveWeekDayResults,
  NEMESIS_SHARED_WEEK_DAYS,
  scoreMarginFromHistory,
  verdictOutcomeFromHistory,
} from '@/lib/nemesis/verdict';
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
 * `NemesisRoom` — the claimed viewer's nemesis-week body (assignment / verdict / empty state
 * machine), extracted verbatim from `/nemesis`'s own page so it can be rendered by BOTH the
 * standalone `/nemesis` route (deep links, share cards — unchanged) and the segmented
 * `/rivals?tab=nemesis` hub (WS17-T2, journeys plan §5). See `/nemesis/page.tsx`'s header for the
 * full design history of these three states — the extraction is behavior-preserving: the two hosts
 * both hand a claimed `profile` in and wrap this component's fragment in their own `<main>`, so
 * `/nemesis`'s rendered DOM (and every `data-testid` the nemesis e2e asserts on) is identical to
 * before. Auth / ghost gating stays with the hosts (each treats a signed-out visitor differently —
 * `/nemesis` redirects to `/claim`, the hub shows the neutral save-gate panel), which is exactly
 * why this component takes an already-resolved claimed `profile` rather than doing its own
 * `auth()`.
 */
export async function NemesisRoom({ profile }: { profile: ProfileRow }) {
  const db = getDb();
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
  // week ahead, no picks landed yet) is ALWAYS `NEMESIS_SHARED_WEEK_DAYS` (7) — that's the whole
  // definition of §8.8's shared set (`[week_start, week_start+6]`), not something to count off
  // however many `daily` rows a given environment happens to have actually seeded. Real data,
  // not fabricated: it's just derived from `week_start` math instead of a data-dependent row
  // count, so it can never drift from the verdict exhibit's own count (`deriveWeekDayResults`
  // below uses the same constant). `bonusQuestionCount` stays row-count-derived — the real number
  // of nemesis_bonus rows this week (§8.8: 2-3, or 0 on the documented fallback) is per-pairing
  // data, not a fixed calendar fact — and is a real COUNT, not a boolean: an earlier pass reduced
  // it to `hasBonusQuestion` and then hard-coded the displayed number to "+1", which no real week
  // can actually have.
  const sharedDayCount = NEMESIS_SHARED_WEEK_DAYS;
  const bonusQuestionCount = pairing
    ? pairing.scoreboard.filter((row) => row.kind === 'nemesis_bonus').length
    : 0;

  const promotedEntry = pageState.kind === 'verdict' ? pageState.entry : null;

  // SW10-T2: the head-to-head banner's day-strip dots come from the promoted entry's own pairing
  // scoreboard (`GET /pairings/:id`, `pairingPublicSchema.scoreboard`) — the history entry itself
  // (`nemesisHistoryEntrySchema`) carries no per-day data. Only fetched for the promoted entry
  // (not every history entry) now that the aggregate list itself lives at `/nemesis/history` —
  // that route derives its own day-results independently for whichever entries it renders.
  // `deriveWeekDayResults`, not `deriveDayResults`: the latter is row-order-based and
  // deliberately INCLUDES the nemesis_bonus row (it counts toward the real score) — right for
  // staying in sync with `my_score`/`their_score`, wrong for a calendar-day strip, which always
  // wants exactly `NEMESIS_SHARED_WEEK_DAYS` dots regardless of how many real rows exist.
  const promotedPairing = promotedEntry ? await getPairingPublicById(db, promotedEntry.pairing_id, at) : null;
  const promotedDayResults: ReadonlyArray<DayResult> =
    promotedEntry && promotedPairing
      ? deriveWeekDayResults(promotedEntry.week_start, promotedPairing.scoreboard, viewerProfileId, promotedPairing)
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
    <>
      {pageState.kind === 'assignment' && pairing && opponentSide ? (
        <div data-testid="nemesis-assignment-state" className="-mx-6">
          <NemesisAssignmentCard
            opponent={opponentSide}
            isRematch={pairing.is_rematch}
            weekStart={pairing.week_start}
            sharedDayCount={sharedDayCount}
            bonusQuestionCount={bonusQuestionCount}
          />
        </div>
      ) : null}

      {pageState.kind === 'verdict' && promotedEntry && promotedVerdict ? (
        <div data-testid="nemesis-verdict-state" className="-mx-6 -mb-10 flex flex-1 flex-col space-y-3">
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
            className="flex flex-1 flex-col"
          />
        </div>
      ) : null}

      {pageState.kind === 'empty' ? (
        <p data-testid="nemesis-empty-state" className="text-muted text-sm">
          No active pairing this week — nemesis assignments go out Monday 9am ET once you have{' '}
          {NEMESIS_MIN_PICKS} graded picks.
        </p>
      ) : null}
    </>
  );
}
