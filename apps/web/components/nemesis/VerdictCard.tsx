import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from 'react';
import { sideAxisPair, Stamp } from '@receipts/ui';
import type { SameSide } from '@receipts/core';
import { nemesisCopy } from '@/lib/copy';
import { DrawBadge } from './DrawBadge';
import { SameSideState, type SameSideSettled } from './SameSideState';

export type VerdictOutcome = 'won' | 'lost' | 'drew';

/** One day's dot, viewer-relative (SW10-T2, `lib/nemesis/verdict.ts`'s shared
 * `dayResultForRow`, fed by either `deriveDayResults` or the calendar-keyed
 * `deriveWeekDayResults` production actually uses): `win`/`loss` iff the viewer picked and was
 * graded that way, `pending` while the row is unsettled, and `neutral` (renamed from the original
 * "split" — this is never a head-to-head "who took the day" comparison, just the viewer's own
 * row) for a void row or a row the viewer didn't pick at all. Rendered by
 * `NemesisHeadToHeadBanner`'s day-strip now, not this card (design-diff audit — see that file's
 * header for why the strip moved out from here). */
export type DayResult = 'win' | 'loss' | 'neutral' | 'pending';

export interface VerdictCardProps {
  outcome: VerdictOutcome;
  opponentHandle: string;
  youWins: number;
  opponentWins: number;
  /** `|youWins - opponentWins|` — how many points the week was decided by (SW10-T2: the prior
   * "edge" framing implied data — an edge/points-of-edge figure — that doesn't exist on the
   * nemesis history entry; this is plain score margin, which does). Powers the loser card's
   * richer line (P3). */
  scoreMargin: number;
  /**
   * WS20-T2 (D-J4) · The viewer-relative same-side day result, straight off the reveal payload's
   * `viewer.nemesis_flip.same_side`. Non-null only on a same-side day — renders the SAME SIDE tape,
   * dual stamps, edge line, and day-winner footer on the verdict face; opposite-side days leave it
   * null and this card renders exactly as before. Viewer-scoped data only (never the ISR shell).
   */
  sameSide?: SameSide | null;
  /** Objective shared-pick outcome for the same-side day above (`null` pre-settle). */
  sameSideSettled?: SameSideSettled;
  /** The week's closing swipe (rematch-by-swipe): right = run it back, left = new fate. Omit for
   * a static/spectator card. */
  onRunItBack?: () => void;
  onNewFate?: () => void;
  className?: string;
  /**
   * SW10-T2: optional drag-surface plumbing for the wrapping `VerdictSwipeCard` — applied ONLY
   * to the paper/score card below, never the button row. Mirrors `SwipeBallot`'s own split
   * between its draggable card (`cardRef`/pointer handlers) and its separate, always-clickable
   * tap wells: if the drag surface swallowed the whole card (buttons included), a real click on
   * "Run it back"/"New fate" would start a zero-distance drag on the wrapper first (pointer
   * capture rides on top of the button), which is exactly the bug this split avoids. Omitted for
   * the static/spectator and tap-only (non-swipe) renders.
   */
  dragSurfaceRef?: Ref<HTMLDivElement>;
  dragSurfaceStyle?: CSSProperties;
  dragSurfaceHandlers?: {
    onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp?: () => void;
    onPointerCancel?: () => void;
  };
  dragSurfaceArmed?: boolean;
}

/** `Stamp`'s variants are `win`/`loss`/`void`/`called_it`/`pending` (§10.4) — none spell "drew",
 * so a `drew` outcome falls back to `DrawBadge`, the established sibling `NemesisHistoryList`'s
 * own `OutcomeBadge` already uses for exactly this gap. */
function OutcomeStamp({ outcome, className }: { outcome: VerdictOutcome; className?: string }) {
  if (outcome === 'won') return <Stamp variant="win" className={className} />;
  if (outcome === 'lost') return <Stamp variant="loss" className={className} />;
  return <DrawBadge className={className} />;
}

/** Radial-dot "ticket perforation" strip (design-diff audit: `docs/mockups/swipe-ux.html`'s
 * `.perf` — `background-image:radial-gradient(circle at center,var(--ink) 40%,transparent 46%);
 * background-size:10px 10px`, scaled ×1.4 — see this file's own round-4 header note). Punches
 * through to this app's own page background (`bg-bg` `#0B0B0D`, the same token the mockup's
 * `--ink` stands in for) so the holes read as real cut-outs regardless of what's actually behind
 * the card. Bleeds edge-to-edge via a negative margin that exactly cancels the card's own
 * horizontal padding, inset from the card's own top/bottom edge by the scaled mockup values too
 * (top and bottom insets land at the same ≈11px net regardless, because the mockup's own
 * top/bottom padding aren't equal either — 22-11=11, 18-7=11). */
function Perforation({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden="true"
      className={`-mx-[21px] h-[7px] shrink-0 bg-[radial-gradient(circle_at_center,#0B0B0D_40%,transparent_46%)] bg-center [background-size:14px_14px] ${edge === 'top' ? '-mt-[11px]' : '-mb-[7px]'}`}
    />
  );
}

/**
 * SW5-T2 · The Friday nemesis verdict card (swipe-ux-plan §2.9, P3). Both players get one; the
 * loser's carries the richer, funnier line. The week's closing decision is a throw —
 * `Run it back` (right, affirmative per D-SW9) requests the rematch, `New fate` (left) lets the
 * engine deal a new stranger. Those two are the accessible axis-ordered controls; a
 * `SwipeBallot variant="verdict"` wraps them as the gesture in the DB-equipped session (the
 * buttons remain the keyboard/AT path either way). Styled as the mockup's own `.hint` row
 * (`docs/mockups/swipe-ux.html` line 190-191, 881: `← NEW FATE` / `RUN IT BACK →`) exactly —
 * plain, NORMAL-weight (not bold) arrow-prefixed text, colored by the swipe axis itself
 * (`.hint .nn{color:var(--no)}` orange for New fate, `.hint .yy{color:var(--yes)}` blue for Run
 * it back — this app's own `side-b`/`side-a` tokens are the same hex values), never gray/gold and
 * never a bordered button box — while staying real `<button>` elements underneath for the
 * keyboard/AT path. Presentational: omit the handlers for the public spectator card.
 *
 * Design-diff audit (round 2, mockup fidelity pass): the paper face now matches the mockup's
 * `.card` base treatment it was missing — a `.qcat`-style small-caps label row ("THE VERDICT" /
 * the real score, `docs/mockups/swipe-ux.html` line 873's "LOSER'S CARD" / "W30" slot), the
 * perforated top/bottom "ticket" edges (`.perf`), and the same faint horizontal paper-line
 * background texture (`background-image:linear-gradient(rgba(20,20,20,.028) 1px,transparent
 * 1px);background-size:100% 26px`). The outcome now ALSO gets its own small rotated stamp
 * (`OutcomeStamp`, reusing `@receipts/ui`'s `Stamp`/this file's sibling `DrawBadge` — the exact
 * `-7deg` rotated-label motif the mockup's own bottom-pinned `.stamp.loss` "TAKEN DOWN" uses,
 * `docs/mockups/swipe-ux.html` line 876), below the heading and margin line. The score no longer
 * repeats a second time next to the heading (the mockup shows it exactly once, in the `.vbolt`
 * badge `NemesisHeadToHeadBanner` already renders) — it moved into the qcat row instead, so it's
 * still real, still visible, just relocated to match where the mockup actually puts a meta line.
 * The day-by-day dot strip moved OUT of this card entirely, to `NemesisHeadToHeadBanner`'s own
 * strip below its score-tug bar — the mockup's `.dots` row sits between `.tug` and the loser's
 * card, never inside it.
 *
 * Design-diff audit (round 3): the card face is `max-w-[80%] mx-auto` — the mockup's own loser's
 * card is 180px inside a 250px phone screen (≈80% of the vsplit's own inset width, a
 * scale-invariant ratio — see round 4 below), a deliberately narrower, more compact "ticket"
 * than the full-bleed panel an earlier pass had.
 *
 * Design-diff audit (round 5): the action row is back in normal document flow, not
 * `fixed inset-x-0 bottom-0` (round 3's attempt at matching the mockup's own
 * `.hint{position:absolute;bottom:9px}`) — a real viewport-fixed bar competes with this app's
 * own INV-9 footer (always the last thing on every page): the footer needs to render BELOW the
 * buttons, and a fixed bar sits permanently on top of it instead. The mockup's phone frame has
 * no footer to collide with, so its literal `position:absolute` doesn't have an equivalent
 * problem here. Colors and weight also got a real fix this round — an earlier pass used
 * `text-muted`/`text-gold`, bold, and a bordered/backed bar treatment, none of which the mockup
 * actually does for this row (see the header's own note above).
 *
 * Design-diff audit (round 4): every absolute measurement here (padding, radius, perforation,
 * qcat/heading font-sizes) is the mockup's own px value scaled ×1.4, not copied literally — an
 * earlier pass matched the mockup's raw pixels 1:1, which reproduces its layout at roughly 70%
 * of its actual physical size on a real mobile viewport (≈340-390px) versus the mockup's own
 * 250px demo phone screen. Percentage widths (`max-w-[80%]`) and `em`-based tracking are already
 * scale-invariant and stay as-is. The heading's font-size is the mockup's own EXHIBIT-SPECIFIC
 * override for this card (15.5px, not the 22.5px base `.qh` rule — the mockup shrinks the
 * headline for this specific loser's-card instance) scaled the same way (×1.4 ≈ 22px).
 *
 * Design-diff audit (round 7): the action row gets its own `px-[42px]` (the mockup's own
 * `.hint{padding:0 30px}`, scaled ×1.4) now that this card's root renders full-bleed edge-to-edge
 * (`app/nemesis/page.tsx`'s round-6 `-mx-6`) — the row has no `max-w-[80%]` centering of its own
 * (unlike the card face above it, the mockup's `.hint` spans the FULL screen width with only its
 * own padding for inset), so without this it rendered flush against the real screen edges. This
 * card's root is also full `flex-1` height now (round 6), and `app/nemesis/page.tsx`'s
 * verdict-state wrapper cancels `<main>`'s own bottom `py-10` via `-mb-10` — `flex-1` only fills
 * `<main>`'s CONTENT box (padding excluded), so without that the action row's `mt-auto` push
 * landed 40px short of the footer, not flush against it as this task's own AC asks for.
 *
 * Not reproduced: the mockup's own bespoke headline for this exhibit ("Dropped 3–2. Third
 * straight week.") bakes in a losing-streak count this app doesn't track anywhere, and its body
 * line ("...by 11 points of edge...") uses the exact "edge" framing this card's own copy is
 * pinned against (`copy.ts`'s `verdictLoserLine`/`verdictWinnerLine` header) — both fabricated
 * relative to `nemesisHistoryEntrySchema`'s real fields, so this keeps the existing
 * margin-only heading/line instead of inventing either.
 */
export function VerdictCard({
  outcome,
  opponentHandle,
  youWins,
  opponentWins,
  scoreMargin,
  sameSide = null,
  sameSideSettled = null,
  onRunItBack,
  onNewFate,
  className = '',
  dragSurfaceRef,
  dragSurfaceStyle,
  dragSurfaceHandlers,
  dragSurfaceArmed = false,
}: VerdictCardProps) {
  const heading =
    outcome === 'won'
      ? nemesisCopy.verdictWon
      : outcome === 'lost'
        ? nemesisCopy.verdictLost
        : nemesisCopy.verdictDrew;
  const line =
    outcome === 'lost'
      ? nemesisCopy.verdictLoserLine(opponentHandle, scoreMargin)
      : outcome === 'drew'
        ? nemesisCopy.verdictDrawLine(opponentHandle)
        : nemesisCopy.verdictWinnerLine(opponentHandle, scoreMargin);
  const interactive = Boolean(onRunItBack || onNewFate);

  const [leftAction, rightAction] = sideAxisPair(
    onNewFate ? (
      <button
        key="new-fate"
        type="button"
        data-testid="verdict-new-fate"
        onClick={onNewFate}
        className="text-side-b flex min-h-11 flex-1 items-center font-mono text-[13px] font-normal tracking-widest uppercase"
      >
        ← {nemesisCopy.newFate}
      </button>
    ) : null,
    onRunItBack ? (
      <button
        key="run-it-back"
        type="button"
        data-testid="verdict-run-it-back"
        onClick={onRunItBack}
        className="text-side-a flex min-h-11 flex-1 items-center justify-end font-mono text-[13px] font-normal tracking-widest uppercase"
      >
        {nemesisCopy.runItBack} →
      </button>
    ) : null,
  );

  return (
    <div
      data-testid="verdict-card"
      data-outcome={outcome}
      className={`flex flex-1 flex-col gap-3 ${className}`}
    >
      <div
        ref={dragSurfaceRef}
        data-testid="verdict-card-face"
        data-armed={dragSurfaceArmed ? 'true' : 'false'}
        className={`bg-paper text-ink relative mx-auto flex max-w-[80%] flex-col gap-3 overflow-hidden rounded-[14px] px-[21px] pt-[22px] pb-[18px] shadow-[0_14px_34px_rgba(0,0,0,0.5)] [background-image:linear-gradient(rgba(20,20,20,0.028)_1px,transparent_1px)] [background-size:100%_26px] ${dragSurfaceHandlers ? 'touch-none select-none' : ''}`}
        style={dragSurfaceStyle}
        {...dragSurfaceHandlers}
      >
        <Perforation edge="top" />

        <div className="text-ink/50 flex items-center justify-between font-mono text-xs tracking-[0.2em] uppercase">
          <span>The verdict</span>
          <span>{nemesisCopy.verdictScore(youWins, opponentWins)}</span>
        </div>

        <h2 className="font-display text-[22px] leading-none font-bold uppercase">{heading}</h2>

        <p className="text-ink/70 font-mono text-[11px] leading-relaxed">{line}</p>

        <OutcomeStamp outcome={outcome} className="w-fit" />

        {/* WS20-T2 (D-J4): the same-side state on the verdict face — only on a same-side day
            (non-null `sameSide`); opposite-side weeks skip it and the face stays byte-identical.
            This is the paper card face, so `surface="paper"`. */}
        {sameSide ? (
          <SameSideState
            sameSide={sameSide}
            opponentHandle={opponentHandle}
            settled={sameSideSettled}
            surface="paper"
          />
        ) : null}

        <Perforation edge="bottom" />
      </div>

      {interactive ? (
        <div dir="ltr" className="mt-auto flex gap-3 px-[42px]">
          {leftAction}
          {rightAction}
        </div>
      ) : null}
    </div>
  );
}
