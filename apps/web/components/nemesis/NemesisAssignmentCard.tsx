import Link from 'next/link';
import { TicketCard } from '@receipts/ui';
import { nemesisCopy } from '@/lib/copy';
import type { PairingSide } from '@/lib/nemesis/types';

export interface NemesisAssignmentCardProps {
  pairingId: string;
  opponent: PairingSide;
  isRematch: boolean;
  className?: string;
}

/**
 * The "Meet your nemesis" reveal card (design doc §19.3 WS7-T6 deliverable, distinct from
 * the full matchup card) — the compact, punchy moment right after weekly assignment
 * (§2.3: Monday 09:00 ET nemesis:assign + notification), before any shared question has
 * locked yet. Links through to the full `NemesisMatchupCard` on `/vs/[pairingId]`.
 */
export function NemesisAssignmentCard({
  pairingId,
  opponent,
  isRematch,
  className = '',
}: NemesisAssignmentCardProps) {
  return (
    <TicketCard className={className}>
      <p className="text-muted text-xs font-semibold uppercase tracking-wide">
        {nemesisCopy.assignmentHeading(isRematch)}
      </p>
      <p className="text-ink mt-1 text-lg font-medium">{opponent.handle}</p>
      {opponent.rating ? (
        <p className="font-mono text-sm">
          {Math.round(opponent.rating.glicko_rating)}
          <span className="text-muted"> rating</span>
          {opponent.rating.accuracy_percentile !== null ? (
            <span className="text-muted"> · Top {100 - opponent.rating.accuracy_percentile}%</span>
          ) : null}
        </p>
      ) : null}
      <p className="text-muted mt-2 text-sm">
        {nemesisCopy.assignmentBody(opponent.handle, isRematch)}
      </p>
      <Link
        href={`/vs/${pairingId}`}
        className="text-side-a mt-3 inline-block text-sm font-medium underline underline-offset-2"
      >
        {nemesisCopy.viewMatchupCta}
      </Link>
    </TicketCard>
  );
}
