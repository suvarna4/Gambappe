import Link from 'next/link';
import { Stamp } from '@receipts/ui';
import { calloutsCopy, nemesisCopy } from '@/lib/copy';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';
import { aggregateGrudges, type GrudgeRecord } from '@/lib/callouts-view';
import { GrudgeRematchButton, type GrudgeRematchState } from '@/components/callouts/GrudgeRematchButton';
import { DrawBadge } from './DrawBadge';

export interface NemesisHistoryListProps {
  entries: NemesisHistoryEntry[];
  className?: string;
  /**
   * WS20-T4 (journeys plan §5, D-J5) grudge-book mode. When set, the same history entries are
   * folded into ONE lifetime aggregate row per rival ("they lead 2–1") with the existing rematch
   * affordance surfaced as `REMATCH`, instead of the default per-week rows. Requires
   * `viewerProfileId` (the rematch endpoint needs to know which side is "you"). Omitted → the
   * original per-week list, unchanged (existing `/nemesis/history` route + tests).
   */
  variant?: 'weeks' | 'grudges';
  viewerProfileId?: string;
}

function OutcomeBadge({ outcome }: { outcome: NemesisHistoryEntry['outcome'] }) {
  if (outcome === 'win' || outcome === 'loss') return <Stamp variant={outcome} />;
  if (outcome === 'draw') return <DrawBadge />;
  return <span className="text-muted text-xs uppercase">Cancelled</span>;
}

/**
 * Lifetime nemesis history (design doc §9.2 `GET /me/nemesis-history`; §19.3 WS7-T6
 * deliverable "history"), now living at its own `/nemesis/history` route (design-diff audit,
 * see that page's header). A plain, compact past-record list — no head-to-head banner, no
 * verdict swipe card, no rematch-request affordance: those all belong to the CURRENT week's
 * actionable verdict on `/nemesis` itself. Explicit design feedback on an earlier version of
 * this route (which reused the banner + swipeable `RematchPanel` per row) was that every row
 * rendered far too large, and that history is a read-only record — "no option to pick new
 * fate/run it back" here. Each row is just the opponent, the score, the week, and the outcome
 * badge.
 */
/** WS20-T4 grudge-book row: a lifetime per-rival aggregate + the `REMATCH` affordance. */
function GrudgeRow({ record, viewerProfileId }: { record: GrudgeRecord; viewerProfileId: string }) {
  const rematchState: GrudgeRematchState | null = record.rematchRequest
    ? {
        id: record.rematchRequest.id,
        direction: record.rematchRequest.direction,
        status: record.rematchRequest.status,
      }
    : null;
  return (
    <li className="flex items-center justify-between gap-4 py-3" data-testid="grudge-row">
      <div>
        <Link href={`/vs/${record.latestPairingId}`} className="font-medium underline underline-offset-2">
          {record.opponent.handle}
        </Link>
        <p className="text-muted font-mono text-xs">
          {calloutsCopy.grudgeRecordLine(record.myWins, record.theirWins)}
          {record.draws > 0 ? ` ${calloutsCopy.grudgeDrawsNote(record.draws)}` : ''} ·{' '}
          {calloutsCopy.grudgeWeeksNote(record.weeks)}
        </p>
      </div>
      <GrudgeRematchButton
        viewerProfileId={viewerProfileId}
        opponent={{ profile_id: record.opponent.profileId, handle: record.opponent.handle }}
        rematchRequest={rematchState}
      />
    </li>
  );
}

export function NemesisHistoryList({
  entries,
  className = '',
  variant = 'weeks',
  viewerProfileId,
}: NemesisHistoryListProps) {
  if (variant === 'grudges') {
    const grudges = aggregateGrudges(entries);
    if (grudges.length === 0 || !viewerProfileId) {
      return <p className={`text-muted text-sm ${className}`}>{calloutsCopy.grudgeEmpty}</p>;
    }
    return (
      <ul className={`divide-surface divide-y ${className}`} data-testid="grudge-book">
        {grudges.map((record) => (
          <GrudgeRow key={record.opponent.profileId} record={record} viewerProfileId={viewerProfileId} />
        ))}
      </ul>
    );
  }

  if (entries.length === 0) {
    return <p className={`text-muted text-sm ${className}`}>{nemesisCopy.historyEmpty}</p>;
  }
  return (
    <ul className={`divide-surface divide-y ${className}`}>
      {entries.map((entry) => (
        <li key={entry.pairing_id} className="flex items-center justify-between gap-4 py-3">
          <div>
            <Link href={`/vs/${entry.pairing_id}`} className="font-medium underline underline-offset-2">
              {entry.opponent.handle}
            </Link>
            <p className="text-muted font-mono text-xs">
              {entry.my_score}–{entry.their_score} · week of {entry.week_start}
              {entry.is_rematch ? ' · rematch' : ''}
            </p>
          </div>
          <OutcomeBadge outcome={entry.outcome} />
        </li>
      ))}
    </ul>
  );
}
