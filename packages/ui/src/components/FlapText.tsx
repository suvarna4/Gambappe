import type { CSSProperties } from 'react';

/**
 * WS24-T1 · `FlapText` — the split-flap (arrivals-board) display primitive (journeys-plan §5,
 * STRETCH). Renders a string as a row of per-character cells with the characteristic split
 * hairline across each cell's middle, and an opt-in flip-in "tick" that cascades cell by cell
 * like a real departures board resettling. First (and only) consumed by the flagged
 * `departures_board` skin on `/sweat` (`DeparturesBoard`); pure/presentational (props in, DOM
 * out — §10.4 rule), no client state.
 *
 * Motion contract (mirrors `Stamp`'s `animated`): the tick is applied through the
 * `motion-safe:[animation:flap-tick_…]` arbitrary utility, so under `prefers-reduced-motion` the
 * utility simply never applies and every cell renders straight into its final resting character
 * — "reduced-motion static", no JS branch. `flap-tick` (defined in `apps/web/app/globals.css`
 * beside the other reveal keyframes) animates `transform: rotateX(...)` only; the cells never
 * carry a persistent `rotate`/`scale` utility, so there is no compose/snap with the standalone
 * `transform` properties (the trap documented on `stamp-slam` in that file).
 *
 * A11y: the decorative cells are `aria-hidden`; an `sr-only` copy of the plain string carries the
 * accessible reading so a screen reader never spells the text out cell by cell. Colours are
 * tokens only — dark `bg` cells with `paper` ink (high contrast, AA-safe on the dark board; the
 * board skin ships dark by design, journeys-plan §5).
 */

/** Per-character flip delay so the cells resettle in sequence, not all at once. */
const CELL_STAGGER_MS = 45;

export interface FlapTextProps {
  /** The text shown across the split-flap cells. Rendered uppercase, one cell per character. */
  children: string;
  /**
   * Opt-in flip-in "tick". Motion-safe only — under `prefers-reduced-motion` the cells render
   * static in their final characters (no animation utility applies).
   */
  animate?: boolean;
  /** Extra classes on the cell-row wrapper (e.g. sizing overrides). */
  className?: string;
  /**
   * Accessible reading of the flap text. Defaults to the raw `children`; override when the
   * on-board glyphs abbreviate something a screen reader should hear in full.
   */
  label?: string;
}

export function FlapText({ children, animate = false, className = '', label }: FlapTextProps) {
  const chars = [...children.toUpperCase()];
  return (
    <span data-flap="" className={`inline-flex items-stretch gap-[2px] ${className}`}>
      <span className="sr-only">{label ?? children}</span>
      {chars.map((ch, i) => {
        const isSpace = ch === ' ';
        return (
          <span
            key={i}
            aria-hidden="true"
            data-flap-cell={isSpace ? 'space' : 'char'}
            className={`relative inline-flex min-w-[0.82em] items-center justify-center rounded-[2px] bg-bg px-[0.18em] py-[0.16em] font-mono text-sm font-bold uppercase leading-none text-paper ${
              animate ? 'motion-safe:[animation:flap-tick_420ms_ease-out_both] ' : ''
            }`}
            style={
              animate ? ({ animationDelay: `${i * CELL_STAGGER_MS}ms` } as CSSProperties) : undefined
            }
          >
            {isSpace ? ' ' : ch}
            {/* The split-flap seam: a hairline across the cell's vertical middle. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-paper/20"
            />
          </span>
        );
      })}
    </span>
  );
}
