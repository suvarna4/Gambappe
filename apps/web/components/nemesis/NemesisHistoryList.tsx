import Link from 'next/link';
import { Stamp } from '@receipts/ui';
import { nemesisCopy } from '@/lib/copy';
import { scoreMarginFromHistory, verdictOutcomeFromHistory } from '@/lib/nemesis/verdict';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';
import type { DayResult } from './VerdictCard';
import { DrawBadge } from './DrawBadge';
import { RematchPanel, type RematchVerdict } from './RematchPanel';

export interface NemesisHistoryListProps {
  viewerProfileId: string;
  entries: NemesisHistoryEntry[];
  /** SW10-T2: per-pairing week-strip dots for the verdict card, keyed by `pairing_id` — derived
   * server-side (`app/nemesis/page.tsx`) from `GET /pairings/:id`'s scoreboard, since the history
   * entry itself carries no per-day data. Absent (or missing a key) just renders that card with
   * an empty dot strip rather than failing — the scoreboard fetch is best-effort. */
  dayResultsByPairingId?: Record<string, ReadonlyArray<DayResult>>;
  className?: string;
}

/** `null` for a `cancelled` entry — `RematchPanel` keeps the plain button/confirm-dialog flow
 * for those, since `VerdictOutcome` has no cancelled member (SW10-T2). */
function verdictFor(
  entry: NemesisHistoryEntry,
  dayResultsByPairingId: Record<string, ReadonlyArray<DayResult>>,
): RematchVerdict | null {
  const outcome = verdictOutcomeFromHistory(entry.outcome);
  if (!outcome) return null;
  return {
    outcome,
    youWins: entry.my_score,
    opponentWins: entry.their_score,
    scoreMargin: scoreMarginFromHistory(entry),
    dayResults: dayResultsByPairingId[entry.pairing_id] ?? [],
  };
}

function OutcomeBadge({ outcome }: { outcome: NemesisHistoryEntry['outcome'] }) {
  if (outcome === 'win' || outcome === 'loss') return <Stamp variant={outcome} />;
  if (outcome === 'draw') return <DrawBadge />;
  return <span className="text-muted text-xs uppercase">Cancelled</span>;
}

/**
 * Lifetime nemesis history (design doc §9.2 `GET /me/nemesis-history`; §19.3 WS7-T6
 * deliverable "history"). Each row offers a rematch request against that past opponent
 * (§8.4 step 0) via `RematchPanel`.
 */
export function NemesisHistoryList({
  viewerProfileId,
  entries,
  dayResultsByPairingId = {},
  className = '',
}: NemesisHistoryListProps) {
  if (entries.length === 0) {
    return <p className={`text-muted text-sm ${className}`}>{nemesisCopy.historyEmpty}</p>;
  }
  return (
    <ul className={`divide-surface divide-y ${className}`}>
      {entries.map((entry) => (
        <li key={entry.pairing_id} className="flex items-center justify-between gap-4 py-3">
          <div>
            <Link
              href={`/vs/${entry.pairing_id}`}
              className="font-medium underline underline-offset-2"
            >
              {entry.opponent.handle}
            </Link>
            <p className="text-muted font-mono text-xs">
              {entry.my_score}–{entry.their_score} · week of {entry.week_start}
              {entry.is_rematch ? ' · rematch' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <OutcomeBadge outcome={entry.outcome} />
            <RematchPanel
              viewerProfileId={viewerProfileId}
              opponent={entry.opponent}
              rematchRequest={
                entry.rematch_request
                  ? {
                      id: entry.rematch_request.id,
                      direction: entry.rematch_request.direction,
                      status: entry.rematch_request.status,
                    }
                  : null
              }
              verdict={verdictFor(entry, dayResultsByPairingId)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
