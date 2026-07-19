'use client';

/**
 * Disband action (design doc §8.5 "disband itself is always unilateral", §9.2
 * `POST /duos/:id/disband`, WS7-T7 task brief: "a disband action (unilateral per §8.5 — no
 * partner confirmation flow, just a confirm-your-own-intent dialog)"). The confirm step here is
 * entirely local UI state — there is no server-side consent flow to model (`duo-disband.ts`'s
 * header: "any single member may act unilaterally, the OTHER member never has to approve, and
 * the only thing owed to them is a notification after the fact"). Mirrors
 * `SettingsClient.tsx`'s delete-account confirm pattern (open → confirm → action), simplified
 * (no typed-handle gate — §11.4's typed-handle confirm is that flow's own heavier bar for an
 * irreversible, higher-stakes action; disbanding a duo doesn't carry that requirement in §8.5).
 */
import { useState } from 'react';
import { duoCopy } from '@/lib/copy';
import { ApiClientError } from '@/lib/pick-client';
import { disbandDuo } from '@/lib/duo-client';

type Phase = 'idle' | 'confirming' | 'disbanding' | 'done' | 'error';

export interface DuoDisbandButtonProps {
  duoId: string;
  partnerHandle: string;
  onDisbanded?: () => void;
  className?: string;
}

export function DuoDisbandButton({ duoId, partnerHandle, onDisbanded, className = '' }: DuoDisbandButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');

  async function confirmDisband() {
    setPhase('disbanding');
    try {
      await disbandDuo(duoId);
      setPhase('done');
      onDisbanded?.();
    } catch (err) {
      // A concurrent disband (partner beat you to it, or a double-tap) surfaces as `NOT_FOUND`
      // (`duo-disband.ts`'s `eligibilityError`-adjacent reuse, see its header) — treat that the
      // same as success rather than showing an error for an outcome the user already wanted.
      if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
        setPhase('done');
        onDisbanded?.();
        return;
      }
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <p className={`text-muted text-sm ${className}`} data-testid="duo-disband-done">
        {duoCopy.disbandDone}
      </p>
    );
  }

  if (phase === 'confirming' || phase === 'disbanding' || phase === 'error') {
    return (
      <div className={className} data-testid="duo-disband-confirm">
        <p className="text-sm">
          {duoCopy.disbandConfirmPrompt.replace('{partner}', partnerHandle)}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="duo-disband-confirm-button"
            disabled={phase === 'disbanding'}
            onClick={confirmDisband}
            className="bg-loss rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {duoCopy.disbandConfirmButton}
          </button>
          <button
            type="button"
            data-testid="duo-disband-cancel-button"
            disabled={phase === 'disbanding'}
            onClick={() => setPhase('idle')}
            className="text-muted text-sm underline underline-offset-2"
          >
            {duoCopy.disbandCancelButton}
          </button>
        </div>
        {phase === 'error' ? (
          <p className="text-loss mt-1 text-xs" role="alert" data-testid="duo-disband-error">
            {duoCopy.disbandError}
          </p>
        ) : null}
      </div>
    );
  }

  // phase === 'idle'
  return (
    <button
      type="button"
      data-testid="duo-disband-open"
      onClick={() => setPhase('confirming')}
      className={`text-loss rounded border border-current px-3 py-1.5 text-sm font-semibold ${className}`}
    >
      {duoCopy.disbandButton}
    </button>
  );
}
