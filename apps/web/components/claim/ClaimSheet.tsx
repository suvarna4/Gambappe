'use client';

/**
 * Dismissible overlay chrome around `ClaimEntry` (design doc §6.3/§11.3 "the claim sheet") —
 * the piece any page's "claim your account" CTA mounts. Self-contained: takes no dependency on
 * any particular page's layout (WS7-T2, this task's sibling dependency, may not exist yet in a
 * given worktree — see the WS7-T5 task brief). Fully controlled (`open`/`onOpenChange`) so the
 * caller owns when it's shown.
 */
import type { AuthProviderId } from '@/lib/auth-providers';
import ClaimEntry from './ClaimEntry';

export interface ClaimSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabledProviders?: AuthProviderId[];
}

export default function ClaimSheet({ open, onOpenChange, enabledProviders }: ClaimSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      {/* Backdrop: a real (keyboard-focusable) button rather than a click handler on a
          non-interactive div, per the a11y bar (§10.4: "all interactive elements
          keyboard-operable"). Removed from tab order since the explicit × button below is the
          primary, labeled way to close. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        className="relative z-10 w-full max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Claim your account"
        data-testid="claim-sheet"
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="text-muted hover:text-paper absolute -top-2 -right-2 z-10 h-8 w-8 rounded-full bg-black/40 text-lg"
        >
          ×
        </button>
        <ClaimEntry presentation="overlay" enabledProviders={enabledProviders} />
      </div>
    </div>
  );
}
