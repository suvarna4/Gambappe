import type { QuestionPublic } from '@receipts/core';
import {
  Barcode,
  CountdownTicker,
  CrowdBar,
  PriceTag,
  Stamp,
  TicketCard,
  sideAxisPair,
} from '@receipts/ui';
import { copy, sweatCopy } from '@/lib/copy';
import { formatClock } from '@/lib/format-et';
import { DeckStage } from './DeckStage';
import { DeckStates } from './DeckStates';

export interface QuestionStateViewProps {
  question: QuestionPublic;
  /** `serverNow - Date.now()` at render time (§9.1 `x-server-time`) — see the page component
   * for why this is computed via `@receipts/core`'s clock rather than a raw `Date.now()` call. */
  serverOffsetMs: number;
  /** Reserved slot for the client-side viewer strip (§10.1: "no layout shift on hydration"). */
  viewerSlot?: React.ReactNode;
  /**
   * SW2-T1: `swipe_ballot` flag (read server-side, passed down). When on, the `open` state
   * renders the full-screen deck (`DeckStage`) instead of the ticket + price-tag layout; every
   * other state is unchanged for now (SW2-T2 converts them). Default `false` keeps the flag-off
   * render byte-identical to today (INV-10) — this prop is not viewer data, so it never touches
   * the INV-10 dual-render proof.
   */
  swipeBallot?: boolean;
}

/**
 * The question page's SERVER-RENDERED shell (§10.2, INV-10): renders `QuestionPublic` only —
 * no identity, no cookies, no `viewer` data anywhere in this component's props or body. That's
 * a structural guarantee, not just a convention: the type above has no field through which
 * viewer-specific data COULD flow, so this component's output is provably identical for every
 * visitor given the same question state (see `test/question-state-view.test.tsx`'s dual-render
 * proof). All identity-dependent rendering (pick buttons, your receipt, undo) lives in
 * `ViewerStrip`, a separate client component that hydrates into `viewerSlot` after paint.
 *
 * Implements the §10.3 state table: one branch per {scheduled, open, locked, revealed, voided}.
 */
export function QuestionStateView({
  question,
  serverOffsetMs,
  viewerSlot,
  swipeBallot = false,
}: QuestionStateViewProps) {
  // SW2-T1/SW2-T2: when the flag is on, the whole question page is the deck. The actionable
  // `open` state is the interactive ballot (DeckStage); the other states render on the same dark
  // stage (DeckStates). Both are viewer-free, so INV-10 holds; the flag-off path below is
  // untouched and stays byte-identical.
  if (swipeBallot) {
    return (
      <div data-testid={`question-state-${question.status}`}>
        {question.status === 'open' ? (
          <DeckStage
            question={question}
            viewerSlot={viewerSlot}
            underLabel={copy.question.tomorrowTeaser}
          />
        ) : (
          <DeckStates question={question} serverOffsetMs={serverOffsetMs} viewerSlot={viewerSlot} />
        )}
      </div>
    );
  }

  return (
    <div data-testid={`question-state-${question.status}`}>
      <TicketCard>
        <div className="space-y-4">
          <header className="space-y-1">
            <h1 className="text-lg font-semibold">{question.headline}</h1>
            {question.blurb ? <p className="text-muted text-sm">{question.blurb}</p> : null}
          </header>

          {question.status === 'scheduled' && (
            <div className="space-y-2" data-testid="question-scheduled">
              <CountdownTicker
                targetIso={question.open_at}
                serverOffsetMs={serverOffsetMs}
                label={copy.question.opensLabel}
              />
              <p className="text-muted text-xs">{formatClock(question.open_at)}</p>
            </div>
          )}

          {question.status === 'open' && (
            <div className="space-y-3" data-testid="question-open">
              {/* D-SW9 (swipe plan §2.2): NO left, YES right; `dir="ltr"` because the axis is
                  visual gesture space — RTL locales must not mirror it. */}
              <div dir="ltr" className="flex flex-wrap gap-6">
                {sideAxisPair(
                  <PriceTag
                    key="no"
                    side="no"
                    label={question.no_label}
                    yesProbability={question.yes_price ?? 0.5}
                  />,
                  <PriceTag
                    key="yes"
                    side="yes"
                    label={question.yes_label}
                    yesProbability={question.yes_price ?? 0.5}
                  />,
                )}
              </div>
              <CountdownTicker
                targetIso={question.lock_at}
                serverOffsetMs={serverOffsetMs}
                label={copy.question.locksInLabel}
              />
              <p className="text-muted text-xs">
                {copy.question.crowdLocksAt(formatClock(question.lock_at))}
              </p>
            </div>
          )}

          {question.status === 'locked' && (
            // WS19-T2 (D-J3): settlement follows the venue, not a synchronized clock reveal — so
            // the old countdown-to-reveal (and its T-10s hush ceremony) is replaced by a static
            // "settles when it settles" line plus the lock-snapshot crowd (public at lock, §9.3).
            // Viewer-free, so the ISR page stays INV-10-clean; `reveal_at` is the target settle
            // instant rendered by the shared display-zone clock.
            <div className="space-y-3" data-testid="question-locked">
              <div data-testid="settle-when" className="space-y-1">
                <p className="font-mono text-sm font-semibold tracking-wide uppercase">
                  {sweatCopy.settlesWhenItSettles}
                </p>
                <p className="text-muted text-xs">
                  {sweatCopy.settlesWhenSub(formatClock(question.reveal_at))}
                </p>
              </div>
              {question.crowd ? (
                <CrowdBar
                  yesCount={question.crowd.yes}
                  noCount={question.crowd.no}
                  yesLabel={question.yes_label}
                  noLabel={question.no_label}
                  surface="paper"
                />
              ) : null}
            </div>
          )}

          {question.status === 'revealed' && (
            <div className="space-y-3" data-testid="question-revealed">
              {/* WS19-T2 (D-J3): the settled header stamps the REAL settle time (`revealed_at`,
                  set when the venue market resolved), replacing the "come back at reveal" framing.
                  The reveal choreography (the stamp slam below) is unchanged — it just plays
                  whenever the page first shows this settled state. */}
              {question.revealed_at ? (
                <p
                  data-testid="settled-at"
                  className="text-muted font-mono text-xs font-semibold tracking-wide uppercase"
                >
                  {sweatCopy.settledAt(formatClock(question.revealed_at))}
                </p>
              ) : null}
              {question.crowd ? (
                <CrowdBar
                  yesCount={question.crowd.yes}
                  noCount={question.crowd.no}
                  yesLabel={question.yes_label}
                  noLabel={question.no_label}
                  surface="paper"
                  animated
                />
              ) : null}
              {/* The reveal-moment "outcome stamp" (§10.3) — viewer-free (outcome is public
                  once revealed), so this can animate here in the SSR shell rather than waiting
                  on the client island. */}
              <p
                className="border-win text-win motion-safe:[animation:stamp-slam_450ms_ease-out_1] inline-block -rotate-3 rounded border-2 px-3 py-1 font-mono text-sm font-bold tracking-wide uppercase"
                data-testid="reveal-outcome-stamp"
              >
                {question.outcome === 'yes' ? question.yes_label : question.no_label}
                <span aria-hidden="true"> ✓</span>
              </p>
              <p className="text-muted text-xs">{copy.question.tomorrowTeaser}</p>
            </div>
          )}

          {question.status === 'voided' && (
            <div className="space-y-3" data-testid="question-voided">
              <Stamp variant="void" />
              <p className="text-muted text-sm">{copy.question.voidedExplainer}</p>
              {question.void_reason ? (
                <p className="text-muted text-xs">{question.void_reason}</p>
              ) : null}
              <p className="text-muted text-xs">{copy.question.tomorrowTeaser}</p>
            </div>
          )}

          {viewerSlot}
        </div>

        <Barcode path={`/q/${question.slug}`} className="mt-4" />
      </TicketCard>
    </div>
  );
}
