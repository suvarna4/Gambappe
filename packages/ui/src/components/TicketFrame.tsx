import type { CSSProperties, ReactNode } from 'react';

import { colors } from '../tokens.js';

/**
 * WS16-T3 · `TicketFrame` — the ONE card shell for the whole product (journeys-plan §2, D-J1).
 *
 * Every paper/receipt surface (BallotCard, TicketCard, ReceiptSlip, ObituaryCard, VerdictCard,
 * the nemesis matchup ticket, the settle receipt) composes this frame instead of re-implementing
 * perforated edges, ADMIT-ONE headers, side notches, and tear-off stubs per screen. This is the
 * consistency guarantee: after WS16-T3 + adopters, the only perforation/stub/admit CSS in the
 * repo lives here (journeys-plan §2 migration rule / grep gate). Pure/presentational: props in,
 * DOM out (§10.4 rule), no gesture or client state.
 *
 * CSS recipe (v3 review artifact "Skin A"): ADMIT header with a 2px bottom rule + `.22em` mono
 * tracking; 14px side notches punched in the stage colour; perf dots
 * `radial-gradient(circle, var(--bg) 40%, transparent 46%)` at 10px spacing; the stub sits on a
 * second paper stock (`paper2`) with a dashed rule and an optional faux barcode
 * (`repeating-linear-gradient`). All colours come from `src/tokens.ts` — nothing is added to the
 * palette. `paper2` (the ticket's second stock) is realised as a low-alpha `ink` wash over
 * `paper` rather than a new hue, so the stub reads as a marginally darker cream without a token.
 */

/** `paper` = the receipt stock on the dark stage; `board` = the dark Departures-board variant
 * (journeys-plan §2 / WS24-T1). Only the surface/ink/rule colours change — the geometry
 * (notches, perf spacing, header rule weight, stub) is identical across tones. */
export type TicketTone = 'paper' | 'board';

export type TicketPerf = 'top' | 'bottom' | 'both';

export interface TicketHeader {
  /** ADMIT-bar left slot, e.g. "GAMBAPPE" / "ECON · DAILY". */
  left: ReactNode;
  /** ADMIT-bar right slot, e.g. "ADMIT ONE" / "№ 212". */
  right: ReactNode;
}

export interface TicketStub {
  /** Serial printed on the tear-off stub (e.g. "№ 2026-07-19"). */
  serial: ReactNode;
  /** Render the faux barcode strip beside the serial. Decorative, never scannable (§10.4). */
  barcode: boolean;
}

export interface TicketFrameProps {
  /** ADMIT-ONE bar: mono, `.22em` tracking, 2px bottom rule. Omit for a bare frame. */
  header?: TicketHeader;
  /** Side punch circles (14px) cut into the stage colour at the vertical centre of each edge. */
  notches?: boolean;
  /** Which horizontal edges carry the perforation dot-line. */
  perf?: TicketPerf;
  /** Tear-off footer on the `paper2` stock, separated by a dashed rule. */
  stub?: TicketStub;
  /** Stock: paper (default) or the dark Departures board. */
  tone?: TicketTone;
  /** Card body. */
  children?: ReactNode;
  /**
   * Absolutely-positioned overlay slot rendered as a direct child of the frame's outer
   * (positioned) container — so a stamp preview / age-gate can anchor to the whole card, exactly
   * as it did when it was a child of BallotCard's own root. Presentational only.
   */
  overlay?: ReactNode;
  className?: string;
  /** Extra classes for the body wrapper (padding overrides for tighter/looser frames). */
  bodyClassName?: string;
  /** Hide the whole frame from the a11y tree (decorative cards, e.g. the deck's peeking slip). */
  ariaHidden?: boolean;
}

interface ToneStyle {
  /** Card surface + default ink colour classes. */
  surface: string;
  /** ADMIT header 2px rule colour. */
  headerRule: string;
  /** Stub second-stock (`paper2`) tint + dashed rule. */
  stubSurface: string;
  stubRule: string;
  /** Faux-barcode bar colour (a token hex, used inside the repeating-linear-gradient). */
  barcodeColor: string;
}

const TONES: Record<TicketTone, ToneStyle> = {
  paper: {
    surface: 'bg-paper text-ink',
    headerRule: 'border-ink/80',
    // `paper2`: a barely-darker cream = `ink` at ~4% over `paper`. No new palette token.
    stubSurface: 'bg-ink/[0.04] text-ink/80',
    stubRule: 'border-ink/40',
    barcodeColor: colors.ink,
  },
  board: {
    // Dark Departures variant (styling only; first consumed by WS24-T1).
    surface: 'bg-surface text-paper',
    headerRule: 'border-paper/40',
    stubSurface: 'bg-bg/60 text-paper/80',
    stubRule: 'border-paper/30',
    barcodeColor: colors.paper,
  },
};

const PERF_SIZE = 10;

export interface TicketPerfMaskOptions {
  /** Punch a dot-line through the top edge. */
  perfTop?: boolean;
  /** Punch a dot-line through the bottom edge. */
  perfBottom?: boolean;
  /** Punch the two side die-cut notches (radius ≈ 0.7 × `size`). */
  notches?: boolean;
  /** Dot pitch in px (default 10). VerdictCard keeps its 14px pitch by passing `size: 14`. */
  size?: number;
}

/**
 * The perforation as a REAL cut-out, not a painted disc. Earlier the "holes" were solid `bg`
 * (`#0B0B0D`) discs painted on top of the paper, so they only read as holes over the identical
 * dark stage — anywhere a paper card overlapped another paper surface (the deck's peeking
 * under-card) the discs showed as black circles. This composes a CSS mask instead: an opaque base
 * layer with the dot/notch discs `exclude`d out of it, so the paper is genuinely removed at each
 * hole and whatever is actually behind the card (stage, under-card, share bg) shows through. The
 * mask only cares about opaque-vs-transparent, so it is tone-agnostic (`paper` + `board`). Apply
 * to the paper SURFACE layer only (never the wrapper that carries the overlay/shadow — those must
 * not be clipped). `-webkit-mask-*` mirrors every longhand for Safari; Chromium (the e2e browser)
 * honours the unprefixed standard.
 */
export function ticketPerfMask(opts: TicketPerfMaskOptions): CSSProperties {
  const size = opts.size ?? PERF_SIZE;
  const notchR = Math.round(size * 0.7);
  const dot = 'radial-gradient(circle, #000 40%, transparent 46%)';

  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];
  const composite: string[] = [];
  const webkitComposite: string[] = [];

  const hole = (image: string, sz: string, pos: string, repeat: string) => {
    images.push(image);
    sizes.push(sz);
    positions.push(pos);
    repeats.push(repeat);
    composite.push('exclude');
    webkitComposite.push('xor');
  };

  if (opts.perfTop) hole(dot, `${size}px ${size}px`, 'top', 'repeat-x');
  if (opts.perfBottom) hole(dot, `${size}px ${size}px`, 'bottom', 'repeat-x');
  if (opts.notches) {
    hole(`radial-gradient(circle ${notchR}px at 0% 50%, #000 99%, transparent)`, '100% 100%', 'center', 'no-repeat');
    hole(`radial-gradient(circle ${notchR}px at 100% 50%, #000 99%, transparent)`, '100% 100%', 'center', 'no-repeat');
  }

  // Opaque base (bottom of the stack) — everything above is `exclude`d (XOR) out of it.
  images.push('linear-gradient(#000 0 0)');
  sizes.push('100% 100%');
  positions.push('center');
  repeats.push('no-repeat');
  composite.push('add');
  webkitComposite.push('source-over');

  const join = (parts: string[]) => parts.join(', ');
  return {
    maskImage: join(images),
    WebkitMaskImage: join(images),
    maskSize: join(sizes),
    WebkitMaskSize: join(sizes),
    maskPosition: join(positions),
    WebkitMaskPosition: join(positions),
    maskRepeat: join(repeats),
    WebkitMaskRepeat: join(repeats),
    maskComposite: join(composite),
    WebkitMaskComposite: join(webkitComposite),
  };
}

function barcodeStyle(color: string): CSSProperties {
  return {
    backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 3px, ${color} 3px 4px, transparent 4px 6px, ${color} 6px 8px, transparent 8px 10px)`,
  };
}

export function TicketFrame({
  header,
  notches = false,
  perf,
  stub,
  tone = 'paper',
  children,
  overlay,
  className = '',
  bodyClassName = '',
  ariaHidden = false,
}: TicketFrameProps) {
  const t = TONES[tone];
  const perfTop = perf === 'top' || perf === 'both';
  const perfBottom = perf === 'bottom' || perf === 'both';
  const hasMask = perfTop || perfBottom || notches;
  // The mask lives on the inner paper SURFACE (below); the outer wrapper stays unmasked so it can
  // carry the caller's drop shadow and the `overlay` (age gate / stamp) without them being clipped
  // by the perforation. Only claim a positioning context when the overlay needs one — a hardcoded
  // `relative` would outrank a caller's `absolute` on source order (the UnderCard position trap).
  const positioned = Boolean(overlay);

  return (
    <div
      data-tone={tone}
      aria-hidden={ariaHidden || undefined}
      className={`${positioned ? 'relative ' : ''}rounded-lg ${className}`}
    >
      <div
        className={`flex flex-col rounded-lg ${t.surface}`}
        style={hasMask ? ticketPerfMask({ perfTop, perfBottom, notches }) : undefined}
      >
        {header ? (
          <div
            className={`flex items-center justify-between border-b-2 ${t.headerRule} px-4 pt-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em]`}
          >
            <span>{header.left}</span>
            <span>{header.right}</span>
          </div>
        ) : null}

        <div className={`flex flex-1 flex-col px-4 py-3 ${bodyClassName}`}>{children}</div>

        {stub ? (
          <div
            className={`flex items-center justify-between gap-3 border-t border-dashed ${t.stubRule} ${t.stubSurface} px-4 py-2 font-mono text-[10px] tracking-[0.22em] uppercase`}
          >
            <span>{stub.serial}</span>
            {stub.barcode ? (
              <span
                aria-hidden="true"
                className="h-5 w-24 opacity-80"
                style={barcodeStyle(t.barcodeColor)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {overlay}
    </div>
  );
}
