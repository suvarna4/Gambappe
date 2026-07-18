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
}

/** §10.4 Stamp motif: rotated bordered label. Color is never the only signal — glyph + text always ship together. */
export function Stamp({ variant, className = '' }: StampProps) {
  const { label, glyph, colorClass } = STAMP_CONFIG[variant];
  return (
    <span
      className={`font-mono ${colorClass} inline-block -rotate-6 rounded border-2 px-3 py-1 text-sm font-bold tracking-widest uppercase ${className}`}
    >
      <span aria-hidden="true">{glyph} </span>
      {label}
    </span>
  );
}
