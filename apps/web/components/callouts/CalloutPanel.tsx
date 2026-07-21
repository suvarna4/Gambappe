import Link from 'next/link';
import { calloutsCopy } from '@/lib/copy';
import type { CalloutCandidate } from '@/lib/callouts-view';
import { CalloutButton } from './CalloutButton';

/**
 * WS20-T4 (journeys plan §5, D-J5) · "Call someone out" panel in the `/rivals` hub. Lists the
 * viewer's past rivals (nemesis-history candidates, deduped upstream by `getCalloutCandidates`),
 * each with a `CalloutButton` that mints + shares a challenge link. Server component — the only
 * interactive bit is the client `CalloutButton`. Empty state when the viewer has no history yet.
 */
export function CalloutPanel({ candidates }: { candidates: CalloutCandidate[] }) {
  return (
    <section data-testid="callout-panel" className="border-surface space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{calloutsCopy.panelHeading}</h2>
        <p className="text-muted text-sm">{calloutsCopy.panelBody}</p>
      </div>

      {candidates.length === 0 ? (
        <p className="text-muted text-sm" data-testid="callout-candidates-empty">
          {calloutsCopy.candidatesEmpty}
        </p>
      ) : (
        <ul className="divide-surface divide-y" data-testid="callout-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.profileId} className="flex items-center justify-between gap-4 py-3">
              <Link href={`/p/${candidate.slug}`} className="font-medium underline underline-offset-2">
                {candidate.handle}
              </Link>
              <CalloutButton candidateHandle={candidate.handle} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
