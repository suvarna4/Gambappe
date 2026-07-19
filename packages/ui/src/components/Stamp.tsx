export type StampVariant = 'win' | 'loss' | 'void' | 'called_it' | 'pending';

/**
 * SW3-T2 (swipe-ux-plan §2.7 "Four inks"): `rubber` is the original solid-border outcome look;
 * `foil` is the gold-gradient ink reserved for `CALLED IT` and season-trophy moments (D-SW1
 * scarcity rule — the only gold *motion* in the product, §2.6); `tape` is a flat mono label
 * strip for non-outcome labels (`STREAK FROZEN`, admin states) that aren't a `StampVariant`;
 * `punch` is an outlined/die-cut treatment, used for `VOID`. Every ink keeps the same rotation,
 * font, and `stamp-slam` motion contract — only the fill/border treatment changes, CSS only.
 */
export type StampInk = 'rubber' | 'foil' | 'tape' | 'punch';

const STAMP_CONFIG: Record<StampVariant, { label: string; glyph: string; colorClass: string; ink: StampInk }> = {
  win: { label: 'WIN', glyph: '✓', colorClass: 'border-win text-win', ink: 'rubber' },
  loss: { label: 'LOSS', glyph: '✗', colorClass: 'border-loss text-loss', ink: 'rubber' },
  void: { label: 'VOID', glyph: '–', colorClass: 'border-muted text-muted', ink: 'punch' },
  // §2.7: "CALLED IT switches to foil" — the only variant whose DEFAULT ink is gold. No other
  // call site in the app passes `ink="foil"` explicitly (enforced by the grep test in
  // `stamp-ink.test.tsx`), so this is the sole place the gold ink can appear.
  called_it: { label: 'CALLED IT', glyph: '★', colorClass: 'border-win text-win', ink: 'foil' },
  /**
   * WS7-T4 addition (contract-change): `pick_result` includes `pending` (§5.3) — both
   * genuinely-ungraded picks and graded-but-unrevealed daily picks (§6.5 publication rule)
   * present as `pending` on public surfaces, and the receipt log needs a stamp for that state
   * too, not just the three terminal outcomes.
   */
  pending: { label: 'PENDING', glyph: '…', colorClass: 'border-muted text-muted', ink: 'rubber' },
};

const INK_CLASSES: Record<StampInk, string> = {
  // The original stamp look: transparent fill, solid border/text carried by `colorClass`.
  rubber: 'rounded border-2 bg-transparent',
  // §2.7 gold-foil: solid gold-gradient fill with a thin gold border and an inset highlight for
  // a foil sheen; dark ink text (never `text-gold` on a gradient fill — that fails contrast).
  // `colorClass` is intentionally NOT applied with this ink (foil replaces the win/loss hue).
  foil: 'rounded border-2 border-[#B8860B] bg-gradient-to-br from-[#FFE9A8] via-[#FFC53D] to-[#B8860B] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]',
  // Mono label strip (STREAK FROZEN, admin states): flat fill, no outcome hue — deliberately
  // low-key next to the loud rubber/foil stamps. `colorClass` is not applied with this ink.
  tape: 'rounded-sm border border-ink/40 bg-ink/85 text-paper',
  // Outlined/die-cut: transparent fill, dashed double-weight border. Keeps `colorClass`'s
  // semantic hue (e.g. VOID's muted tone) — only the border style changes.
  punch: 'rounded border-2 border-dashed bg-transparent',
};

export interface StampProps {
  variant: StampVariant;
  /**
   * SW3-T2 (§2.7): overrides the variant's default ink (`rubber` for outcomes, `foil` for
   * `called_it`, `punch` for `void`). Exposed mainly for `tape` (`STREAK FROZEN`/admin labels
   * aren't `StampVariant` outcomes, so they need an explicit ink on a `win`/`loss`-shaped stamp)
   * and the `/dev/ui` gallery. Leave unset for the normal outcome stamps.
   */
  ink?: StampInk;
  className?: string;
  /**
   * WS7-T3 reveal-moment "stamp slam" entrance (§10.3). Opt-in — every other call site (pick
   * receipts, the voided-state stamp, etc.) must stay motionless: "Motion budget exists only
   * here." Honors `prefers-reduced-motion` via the `motion-safe:` variant with no JS branch
   * needed — under reduced motion the animation utility simply never applies, so the element
   * renders straight into its final (already-correct) resting state.
   */
  animated?: boolean;
}

/** §10.4/§2.7 Stamp motif: rotated label, one of four inks. Color/fill is never the only
 * signal — glyph + text always ship together. Rotation is a fixed −7° for every ink (§2.7). */
export function Stamp({ variant, ink, className = '', animated = false }: StampProps) {
  const { label, glyph, colorClass, ink: defaultInk } = STAMP_CONFIG[variant];
  const resolvedInk = ink ?? defaultInk;
  const motionClass = animated ? 'motion-safe:[animation:stamp-slam_450ms_ease-out_1]' : '';
  // `foil`/`tape` supply their own border+text color (see `INK_CLASSES` comments); combining
  // them with `colorClass` would fight the gold/mono treatment with the outcome hue.
  const colorSource = resolvedInk === 'foil' || resolvedInk === 'tape' ? '' : colorClass;
  return (
    <span
      data-ink={resolvedInk}
      className={`font-mono ${colorSource} ${INK_CLASSES[resolvedInk]} inline-block -rotate-[7deg] px-3 py-1 text-sm font-bold tracking-widest uppercase ${motionClass} ${className}`}
    >
      <span aria-hidden="true">{glyph} </span>
      {label}
    </span>
  );
}
