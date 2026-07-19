/**
 * Satori-safe presentational building blocks for the six `/api/og/*` templates (design doc
 * §10.5, §10.4 motifs). Satori (what `next/og`'s `ImageResponse` renders through) only
 * understands a constrained flexbox-and-inline-style subset of CSS — no Tailwind classes, no
 * external stylesheets, no `background-image` gradients — so these are NOT the
 * `@receipts/ui` React components (`TicketCard`, `Stamp`, ...), which use Tailwind
 * `className` and are meant for real DOM. They deliberately reuse `@receipts/ui`'s *tokens*
 * (`colors`, `fonts`) and pure formatting helpers (`impliedCents`, `crowdSplit`,
 * `barcodePattern`) so the two systems stay visually in sync without sharing JSX — see
 * `packages/ui/src/tokens.ts`'s own comment anticipating exactly this split.
 *
 * SPEC-GAP(WS8-T1): §10.4 pins numerals/prices to `IBM Plex Mono` and UI text to `Inter`.
 * Satori requires font data as an explicit buffer (no system-font access); `next/og` falls
 * back to a bundled Noto Sans when none is supplied. Embedding the brand fonts needs their
 * binary files vendored into the repo (or fetched at build time) — left as follow-up so this
 * task doesn't ship a network dependency on Google Fonts at render time. Tracked here rather
 * than silently shipping the wrong typeface.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { barcodePattern, colors, fonts, sideAxisPair } from '@receipts/ui';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const flexCol: CSSProperties = { display: 'flex', flexDirection: 'column' };
const flexRow: CSSProperties = { display: 'flex', flexDirection: 'row' };

/**
 * The canvas every template renders into. Defaults to the §10.5 OG dimensions (1200×630,
 * "1200×630 only" — an OG call site never passes `width`/`height`). WS8-T2 share cards render
 * the SAME templates at story (1080×1920) / square (1080×1080) — passing those through here
 * rather than forking the canvas per surface, so card layouts stay a strict superset of the OG
 * ones (same flex/space-between structure, just a taller or squarer box) instead of two
 * independently-drifting layouts.
 */
export function OgCanvas({
  children,
  width = OG_WIDTH,
  height = OG_HEIGHT,
}: {
  children: ReactNode;
  width?: number;
  height?: number;
}): ReactElement {
  return (
    <div
      style={{
        ...flexCol,
        width,
        height,
        backgroundColor: colors.bg,
        color: colors.paper,
        padding: 56,
        justifyContent: 'space-between',
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
}

/** The paper `TicketCard` motif, satori-safe: solid paper surface, no gradient perforation. */
export function OgTicket({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      style={{
        ...flexCol,
        backgroundColor: colors.paper,
        color: colors.ink,
        borderRadius: 12,
        padding: '28px 36px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Glyphs are deliberately plain ASCII, not the design system's ✓/✗/★ (Stamp.tsx uses those
// in real DOM, where the browser's own font stack covers them for free). Satori/`next/og`
// has only the bundled Noto Sans Latin subset (see render.tsx's SPEC-GAP note) and falls
// back to fetching a symbol/emoji font from Google Fonts over the network for anything
// outside it — a render-time network dependency this task explicitly avoids taking on. ASCII
// keeps every template renderable offline with the bundled font, at the cost of the fancier
// glyphs; swap back once real font embedding lands.
const STAMP_CONFIG = {
  win: { label: 'WIN', glyph: '+', color: colors.win },
  loss: { label: 'LOSS', glyph: 'X', color: colors.loss },
  void: { label: 'VOID', glyph: '-', color: colors.muted },
  called_it: { label: 'CALLED IT', glyph: '*', color: colors.win },
} as const;

export type OgStampVariant = keyof typeof STAMP_CONFIG;

/** §10.4 Stamp motif — glyph + text always ship together, never color alone. */
export function OgStamp({ variant }: { variant: OgStampVariant }): ReactElement {
  const { label, glyph, color } = STAMP_CONFIG[variant];
  return (
    <div
      style={{
        ...flexRow,
        alignItems: 'center',
        gap: 10,
        border: `3px solid ${color}`,
        borderRadius: 8,
        color,
        padding: '10px 20px',
        fontFamily: fonts.mono,
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: 2,
        transform: 'rotate(-4deg)',
      }}
    >
      <span>{glyph}</span>
      <span>{label}</span>
    </div>
  );
}

/** §10.4 PriceTag — "YES @ 63¢", cents-of-probability, never money. */
export function OgPriceTag({ side, cents }: { side: 'yes' | 'no'; cents: number }): ReactElement {
  const bg = side === 'yes' ? colors.sideA : colors.sideB;
  return (
    <div
      style={{
        ...flexRow,
        alignItems: 'center',
        backgroundColor: bg,
        color: colors.bg,
        borderRadius: 6,
        padding: '8px 16px',
        fontFamily: fonts.mono,
        fontSize: 28,
        fontWeight: 700,
      }}
    >
      {side.toUpperCase()} @ {cents}¢
    </div>
  );
}

/** §10.4 CrowdBar — side-A/side-B split, colorblind-safe pair, always paired with the %.
 * Axis order (D-SW9, swipe plan §2.2): NO fills from the left edge, YES from the right —
 * both segments and labels — matching the in-DOM `CrowdBar`. The `data-side` attrs are for
 * the axis-order unit tests (satori ignores unknown props); satori has no RTL layout, so no
 * `dir` equivalent is needed here. */
export function OgCrowdBar({ yesPct }: { yesPct: number }): ReactElement {
  const pct = Math.max(0, Math.min(100, Math.round(yesPct)));
  const noPct = 100 - pct;
  return (
    <div style={{ ...flexCol, width: '100%', gap: 8 }}>
      <div
        style={{
          ...flexRow,
          width: '100%',
          height: 28,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {sideAxisPair(
          <div
            key="no"
            data-side="no"
            style={{ width: `${noPct}%`, backgroundColor: colors.sideB, display: 'flex' }}
          />,
          <div
            key="yes"
            data-side="yes"
            style={{ width: `${pct}%`, backgroundColor: colors.sideA, display: 'flex' }}
          />,
        )}
      </div>
      <div
        style={{
          ...flexRow,
          justifyContent: 'space-between',
          fontFamily: fonts.mono,
          fontSize: 20,
          color: colors.muted,
        }}
      >
        {sideAxisPair(
          <span key="no" data-side="no">
            NO {noPct}%
          </span>,
          <span key="yes" data-side="yes">
            YES {pct}%
          </span>,
        )}
      </div>
    </div>
  );
}

/** §10.4 StreakFlame — count in mono. ASCII label, not the 🔥 emoji — see the STAMP_CONFIG
 * comment above on why satori templates avoid glyphs outside the bundled Latin font. */
export function OgStreakFlame({ count }: { count: number }): ReactElement {
  return (
    <div style={{ ...flexRow, alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: fonts.mono, fontSize: 20, color: colors.muted }}>STREAK</span>
      <span style={{ fontFamily: fonts.mono, fontSize: 28, fontWeight: 700 }}>{count}</span>
    </div>
  );
}

/**
 * §10.4 Barcode footer strip: decorative bar pattern rendering the page path as text beneath
 * it (no separate short-URL system exists — this IS the "link").
 */
export function OgBarcodeFooter({ path }: { path: string }): ReactElement {
  const bars = barcodePattern(path, 60);
  return (
    <div style={{ ...flexCol, gap: 6 }}>
      <div style={{ ...flexRow, alignItems: 'flex-end', gap: 2, height: 20 }}>
        {bars.map((h, i) => (
          // Index-as-key is fine here: `bars` is a fixed-length, never-reordered decorative
          // pattern recomputed fresh from `path` on every render, not a list of entities.
          <div
            key={i}
            style={{ width: 3, height: h * 2, backgroundColor: colors.muted, display: 'flex' }}
          />
        ))}
      </div>
      <span style={{ fontFamily: fonts.mono, fontSize: 16, color: colors.muted }}>{path}</span>
    </div>
  );
}

/**
 * §10.5 share-card footer: "Every card renders the page URL + QR (bottom strip) — doors, not
 * screenshots (P9)." Unlike `OgBarcodeFooter`'s decorative bar pattern (OG images, no real
 * link-out expected), this renders an actual scannable QR — `qrDataUri` is a
 * `data:image/png;base64,...` string from `lib/og/qr.ts`, pre-generated by the route handler
 * (see that file's header comment on why generation happens outside these otherwise-pure
 * template functions). Satori/`next/og` renders `<img src="data:...">` directly, no network
 * fetch, same offline-renderable posture as the barcode footer.
 */
export function OgQrFooter({ path, qrDataUri }: { path: string; qrDataUri: string }): ReactElement {
  return (
    <div style={{ ...flexRow, alignItems: 'flex-end', gap: 16 }}>
      <img src={qrDataUri} width={110} height={110} alt="" style={{ borderRadius: 4 }} />
      <span style={{ fontFamily: fonts.mono, fontSize: 16, color: colors.muted }}>{path}</span>
    </div>
  );
}

export function OgRow({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  return <div style={{ ...flexRow, ...style }}>{children}</div>;
}

export function OgHeadline({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        ...flexRow,
        fontSize: 44,
        fontWeight: 700,
        lineHeight: 1.15,
        color: colors.paper,
      }}
    >
      {children}
    </div>
  );
}

export function OgHandleRow({ handle }: { handle: string }): ReactElement {
  return (
    <div style={{ ...flexRow, fontFamily: fonts.mono, fontSize: 24, color: colors.muted }}>
      {handle}
    </div>
  );
}
