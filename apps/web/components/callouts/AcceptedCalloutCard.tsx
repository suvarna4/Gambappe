import { Stamp, TapeLabel } from '@receipts/ui';
import { calloutsCopy } from '@/lib/copy';
import type { AcceptedCalloutView } from '@/lib/callouts-view';

/**
 * WS20-T4 (journeys plan §5, D-J5) · The "locked in — you face {handle} next week" confirmation
 * both the challenger's AND the acceptor's `/rivals` hubs show once a call-out is accepted (§5 AC:
 * "both `/rivals` screens show it"). An accepted call-out mints a `scheduled` NEXT-week pairing,
 * which the current-week nemesis surface (`NemesisRoom`) doesn't render — so this card is what
 * makes the accepted pairing visible on both sides right away. Presentational; the data comes from
 * `getAcceptedCalloutViews`.
 */
export function AcceptedCalloutCard({ views }: { views: AcceptedCalloutView[] }) {
  if (views.length === 0) return null;
  return (
    <section data-testid="accepted-callouts" className="space-y-3">
      {views.map((view) => (
        <div
          key={view.calloutId}
          data-testid="accepted-callout-card"
          className="border-surface flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <div className="space-y-2">
            <TapeLabel>{calloutsCopy.lockedInTapeLabel}</TapeLabel>
            <p className="text-sm font-medium" data-testid="accepted-callout-line">
              {calloutsCopy.lockedInLine(view.opponentHandle)}
            </p>
          </div>
          <Stamp variant="called_it" />
        </div>
      ))}
    </section>
  );
}
