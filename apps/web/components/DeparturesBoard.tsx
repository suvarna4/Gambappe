import Link from 'next/link';
import { FlapText, TicketFrame } from '@receipts/ui';
import { departuresCopy, sweatCopy } from '@/lib/copy';
import type { SweatPosition } from '@/lib/sweat-feed';

/**
 * WS24-T1 · The flagged `departures_board` skin of the Sweat room (journeys-plan §5, STRETCH):
 * the viewer's open positions re-laid-out as a split-flap arrivals board instead of paper
 * receipts. Composes `TicketFrame tone="board"` (the dark Departures variant, journeys-plan §2)
 * as the panel and `FlapText` for each row's settle STATUS cell — the signature board element,
 * flipping in like a real board resettling. Pure/presentational: it takes the same
 * `SweatPosition[]` the paper `SweatRow` list takes, so the page reuses one feed for both skins.
 *
 * Gated entirely by the caller (`/sweat` reads `departures_board`); when the flag is off this
 * component is never rendered and the paper path is byte-identical to WS19-T2 (flag-off
 * regression: `e2e/departures-board.spec.ts`). Ships dark by design — receipts stay paper.
 *
 * A11y (§10.4): drift keeps `SweatRow`'s contract — win/loss ink is AA-safe on the dark board and
 * always pairs with a ▲/▼ glyph + sign, so colour is never the only signal. No `gold` token
 * anywhere (gold is reserved for wins).
 */
export interface DeparturesBoardProps {
  positions: SweatPosition[];
  /**
   * Opt-in flip-in tick on the STATUS cells (on in the live room; off in the `/dev/ui` gallery
   * for a stable screenshot baseline). Reduced-motion renders static regardless (FlapText is
   * motion-safe).
   */
  animate?: boolean;
  className?: string;
}

function driftPresentation(drift: SweatPosition['drift']): { text: string; className: string } {
  switch (drift.direction) {
    case 'up':
      return { text: sweatCopy.driftUp(drift.cents ?? 0), className: 'text-win' };
    case 'down':
      return { text: sweatCopy.driftDown(Math.abs(drift.cents ?? 0)), className: 'text-loss' };
    case 'flat':
      return { text: sweatCopy.driftFlat, className: 'text-muted' };
    default:
      return { text: sweatCopy.driftUnknown, className: 'text-muted' };
  }
}

function DeparturesRow({ position, animate }: { position: SweatPosition; animate?: boolean }) {
  const { headline, side, sideLabel, entryCents, drift, settleWhen, slug } = position;
  const driftView = driftPresentation(drift);

  const headlineNode = slug ? (
    <Link
      href={`/q/${slug}`}
      className="hover:text-paper/80 transition-colors"
      data-testid="departures-row-link"
    >
      {headline}
    </Link>
  ) : (
    headline
  );

  return (
    <div
      data-testid="departures-row"
      data-side={side}
      data-settle-kind={settleWhen.kind}
      className="border-paper/10 grid grid-cols-[minmax(4.75rem,auto)_1fr_auto] items-center gap-3 border-t py-3 first:border-t-0"
    >
      <div>
        <FlapText animate={animate}>{settleWhen.text}</FlapText>
      </div>
      <div className="min-w-0">
        <p className="text-paper font-display truncate text-sm font-bold uppercase">
          {headlineNode}
        </p>
        <p className="text-muted font-mono text-[11px] uppercase tracking-wide">
          {sweatCopy.entryAt(sideLabel, entryCents)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span
          data-testid="departures-drift"
          className={`font-mono text-xs font-bold ${driftView.className}`}
        >
          {driftView.text}
        </span>
      </div>
    </div>
  );
}

export function DeparturesBoard({ positions, animate = false, className = '' }: DeparturesBoardProps) {
  return (
    <TicketFrame
      tone="board"
      header={{ left: departuresCopy.boardTitle, right: departuresCopy.boardGate }}
      perf="bottom"
      stub={{ serial: departuresCopy.serial, barcode: true }}
      className={className}
    >
      <div data-testid="departures-board">
        <div className="text-muted border-paper/20 grid grid-cols-[minmax(4.75rem,auto)_1fr_auto] items-center gap-3 border-b pb-2 font-mono text-[9px] tracking-[0.2em] uppercase">
          <span>{departuresCopy.colStatus}</span>
          <span>{departuresCopy.colDestination}</span>
          <span className="text-right">{departuresCopy.colDrift}</span>
        </div>
        {positions.map((position) => (
          <DeparturesRow key={position.pickId} position={position} animate={animate} />
        ))}
      </div>
    </TicketFrame>
  );
}
