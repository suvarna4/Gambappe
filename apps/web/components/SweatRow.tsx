import Link from 'next/link';
import { sweatCopy } from '@/lib/copy';
import type { SweatPosition } from '@/lib/sweat-feed';

export interface SweatRowProps {
  position: SweatPosition;
  /** Rendered inside a heading list on `/sweat`; the deck's end-of-stack (WS18-T3) reuses it in
   * a plain list. Purely presentational either way. */
  className?: string;
}

/**
 * WS19-T2 · One open-position row for the Sweat room (`docs/journeys-plan.md` §5, D-J3), exported
 * for reuse by the deck's end-of-stack top-3 sweat rows (WS18-T3). Pure/presentational (props in,
 * DOM out) — no client state, so it drops into a Server Component (`/sweat`) and a Client one
 * (the deck) alike.
 *
 * Layout: headline (a deep link to `/q/[slug]` when the question has one) · held side + stamped
 * entry price · signed live drift · settle-when label. The drift's win/loss hue is AA-safe on the
 * app's dark `bg` (§10.4), and it always ships a ▲/▼ glyph + sign so colour is never the only
 * signal — a deliberate contrast-safe choice given win/loss ink fails on cream `bg-paper`.
 */
export function SweatRow({ position, className = '' }: SweatRowProps) {
  const { headline, side, sideLabel, entryCents, drift, settleWhen, slug } = position;

  const driftClass =
    drift.direction === 'up'
      ? 'text-win'
      : drift.direction === 'down'
        ? 'text-loss'
        : 'text-muted';
  const driftText =
    drift.direction === 'up'
      ? sweatCopy.driftUp(drift.cents ?? 0)
      : drift.direction === 'down'
        ? sweatCopy.driftDown(Math.abs(drift.cents ?? 0))
        : drift.direction === 'flat'
          ? sweatCopy.driftFlat
          : sweatCopy.driftUnknown;

  const headlineNode = slug ? (
    <Link href={`/q/${slug}`} className="hover:text-paper/80 transition-colors" data-testid="sweat-row-link">
      {headline}
    </Link>
  ) : (
    headline
  );

  return (
    <div
      data-testid="sweat-row"
      data-side={side}
      data-settle-kind={settleWhen.kind}
      className={`border-surface flex items-center gap-3 border-b py-3 last:border-b-0 ${className}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-paper truncate text-sm font-semibold">{headlineNode}</p>
        <p className="text-muted font-mono text-[11px] tracking-wide uppercase">
          {sweatCopy.entryAt(sideLabel, entryCents)}
          <span aria-hidden="true"> · </span>
          <span className={driftClass}>{driftText}</span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span
          data-testid="sweat-settle-label"
          className="font-display text-paper block text-sm font-bold tracking-wide uppercase"
        >
          {settleWhen.text}
        </span>
        <span className="text-muted font-mono text-[9px] tracking-[0.2em] uppercase">
          {sweatCopy.settleWhenCaption}
        </span>
      </div>
    </div>
  );
}
