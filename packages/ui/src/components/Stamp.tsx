export type StampVariant = 'win' | 'loss' | 'void' | 'called_it' | 'pending';

const STAMP_CONFIG: Record<StampVariant, { label: string; glyph: string; colorClass: string }> = {
  win: { label: 'WIN', glyph: '✓', colorClass: 'border-win text-win' },
  loss: { label: 'LOSS', glyph: '✗', colorClass: 'border-loss text-loss' },
  void: { label: 'VOID', glyph: '–', colorClass: 'border-muted text-muted' },
  called_it: { label: 'CALLED IT', glyph: '★', colorClass: 'border-win text-win' },
  /**
   * WS7-T4 addition (contract-change): `pick_result` includes `pending` (§5.3) — both
   * genuinely-ungraded picks and graded-but-unrevealed daily picks (§6.5 publication rule)
   * present as `pending` on public surfaces, and the receipt log needs a stamp for that state
   * too, not just the three terminal outcomes.
   */
  pending: { label: 'PENDING', glyph: '…', colorClass: 'border-muted text-muted' },
};

export interface StampProps {
  variant: StampVariant;
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

/** §10.4 Stamp motif: rotated bordered label. Color is never the only signal — glyph + text always ship together. */
export function Stamp({ variant, className = '', animated = false }: StampProps) {
  const { label, glyph, colorClass } = STAMP_CONFIG[variant];
  const motionClass = animated ? 'motion-safe:[animation:stamp-slam_450ms_ease-out_1]' : '';
  return (
    <span
      className={`font-mono ${colorClass} inline-block -rotate-6 rounded border-2 px-3 py-1 text-sm font-bold tracking-widest uppercase ${motionClass} ${className}`}
    >
      <span aria-hidden="true">{glyph} </span>
      {label}
    </span>
  );
}
