/**
 * WS26-T6 (docs/plans/cpu-nemesis-wbs.md): the mandatory CPU disclosure chip. Rendered next
 * to a CPU rival's handle EVERYWHERE one appears (matchup, assignment, profile header) — the
 * integrity guardrail is that a user always knows their rival is a bot; the bot-flavored
 * handle alone is not the disclosure mechanism. `data-testid="cpu-badge"` is the e2e hook.
 */
export interface CpuBadgeProps {
  personaLabel?: string | null;
  className?: string;
}

export function CpuBadge({ personaLabel, className }: CpuBadgeProps) {
  return (
    <span
      data-testid="cpu-badge"
      title={personaLabel ? `House bot — ${personaLabel}` : 'House bot'}
      className={`border-line text-muted inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase tracking-wider ${className ?? ''}`}
    >
      <span aria-hidden>🤖</span>
      CPU
      {personaLabel ? <span className="normal-case tracking-normal">· {personaLabel}</span> : null}
    </span>
  );
}
