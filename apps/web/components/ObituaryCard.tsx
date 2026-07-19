import { sideAxisPair } from '@receipts/ui';
import { obituaryCopy } from '@/lib/copy';

export interface ObituaryFact {
  /** A single data-derived line, e.g. "3 longshots called" or "1 freeze spent". */
  text: string;
}

export interface ObituaryCardProps {
  /** Length of the broken run. */
  days: number;
  /** Pre-formatted birth/death dates (e.g. "Jul 08" / "Jul 19"). */
  startLabel: string;
  endLabel: string;
  /** 2–3 data-derived "survived" facts (the caller builds these from the pick log). */
  facts: ObituaryFact[];
  /** The losing pick that ended it. */
  sideLabel: string;
  entryCents: number;
  /** Interactive actions (in-app). Omit for the static share/OG artifact (SW4-T2). */
  onBury?: () => void;
  onShare?: () => void;
  className?: string;
}

const perforationStyle = {
  backgroundImage: 'radial-gradient(circle at center, #0B0B0D 40%, transparent 42%)',
  backgroundSize: '10px 10px',
  backgroundRepeat: 'repeat-x',
  backgroundPosition: 'center',
} as const;

/**
 * SW4-T1 · The busted-streak obituary card (swipe-ux-plan §2.7, P3 "the loser is the
 * protagonist"). A tombstone on aged paper: the streak's dates, what it survived, and the pick
 * it died on — written by the app from data, never performed by the user. Gets equal-or-greater
 * craft than the win card because the loss screenshot is the funnier one. The `Bury it` /
 * `Share the obituary` actions obey the side-axis rule for a consistent left=dismiss /
 * right=commit gesture. Presentational: the same layout backs the `busted-streak` OG template
 * (SW4-T2) with the actions omitted.
 */
export function ObituaryCard({
  days,
  startLabel,
  endLabel,
  facts,
  sideLabel,
  entryCents,
  onBury,
  onShare,
  className = '',
}: ObituaryCardProps) {
  const interactive = Boolean(onBury || onShare);

  const [leftAction, rightAction] = sideAxisPair(
    onBury ? (
      <button
        key="bury"
        type="button"
        data-testid="obituary-bury"
        onClick={onBury}
        className="text-muted min-h-11 flex-1 rounded-lg border font-display text-sm font-bold tracking-wide uppercase"
      >
        {obituaryCopy.bury}
      </button>
    ) : null,
    onShare ? (
      <button
        key="share"
        type="button"
        data-testid="obituary-share"
        onClick={onShare}
        className="border-gold text-gold min-h-11 flex-1 rounded-lg border font-display text-sm font-bold tracking-wide uppercase"
      >
        {obituaryCopy.share}
      </button>
    ) : null,
  );

  return (
    <div data-testid="obituary-card" className={`space-y-2 ${className}`}>
      <div className="bg-paper text-ink relative flex flex-col rounded-lg px-4 pt-3 pb-3 shadow-[0_14px_34px_rgba(0,0,0,0.5)]">
        <div aria-hidden="true" className="h-1.5 -translate-y-1" style={perforationStyle} />

        <p className="text-ink/70 font-mono text-[9px] font-semibold tracking-widest uppercase">
          {obituaryCopy.eyebrow}
        </p>
        <h2 className="font-display mt-2 text-xl leading-[1.05] font-bold uppercase">
          {obituaryCopy.title(days)}
        </h2>
        <p className="text-ink/70 mt-1 font-mono text-[11px]">
          {obituaryCopy.dates(startLabel, endLabel)}
        </p>

        {facts.length > 0 ? (
          <div className="mt-2">
            <p className="text-ink/70 font-mono text-[9px] tracking-widest uppercase">
              {obituaryCopy.survivedLabel}
            </p>
            <ul className="text-ink mt-0.5 font-mono text-[11px] leading-relaxed">
              {facts.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-ink/70 mt-2 font-mono text-[11px]">
          {obituaryCopy.causeOfDeath(sideLabel, entryCents)}
        </p>

        <div className="mt-3 flex items-end justify-between">
          <span className="border-loss inline-block -rotate-6 rounded border-2 px-2.5 py-0.5 font-display text-base font-bold text-[#a11731] uppercase">
            {obituaryCopy.stamp}
          </span>
          <span className="text-ink/70 font-mono text-[11px]">🕯 {obituaryCopy.rip(days)}</span>
        </div>

        <div aria-hidden="true" className="mt-3 h-1.5 translate-y-1" style={perforationStyle} />
      </div>

      {interactive ? (
        <>
          <div dir="ltr" className="flex gap-2">
            {leftAction}
            {rightAction}
          </div>
          <p className="text-muted text-center font-mono text-[11px]">{obituaryCopy.consolation}</p>
        </>
      ) : null}
    </div>
  );
}
