'use client';

/**
 * The client-side "prompt engine" (design doc §11.3, WS7-T5): decides whether to render the
 * dismissible claim nudge, using the pure trigger logic in `lib/claim-prompt-engine.ts`. Mounts
 * anywhere a caller has the relevant ghost signals available (streak, pick count, whether the
 * viewer is looking at a nemesis/duo surface as a ghost) — see that module's doc comment for why
 * those signals are taken as plain props rather than fetched internally (WS3/WS5, the features
 * that produce them, haven't merged yet in this worktree).
 *
 * "Never blocks the pick loop" (§11.3): this component only ever renders a small dismissible
 * banner alongside whatever else is on the page — it never intercepts or gates any other action.
 */
import { useEffect, useRef, useState } from 'react';
import type { AuthProviderId } from '@/lib/auth-providers';
import {
  evaluateClaimPrompt,
  markShownToday,
  type ClaimPromptInput,
} from '@/lib/claim-prompt-engine';
import { CLAIM_NUDGE_COPY, CLAIM_PROMPT_CTA, CLAIM_PROMPT_DISMISS_LABEL, type ClaimNudgeTrigger } from '@/lib/copy';
import { postAnalyticsEvent } from '@/lib/analytics-client';
import ClaimSheet from './ClaimSheet';

export interface ClaimPromptEngineProps extends ClaimPromptInput {
  enabledProviders?: AuthProviderId[];
}

export default function ClaimPromptEngine({ enabledProviders, ...input }: ClaimPromptEngineProps) {
  const [trigger, setTrigger] = useState<ClaimNudgeTrigger | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const shownFiredRef = useRef(false);

  const { isGhost, streakCurrent, pickCount, viewingNemesisOrDuoSurfaceAsGhost } = input;

  useEffect(() => {
    if (dismissed || sheetOpen) return;
    setTrigger(
      evaluateClaimPrompt({ isGhost, streakCurrent, pickCount, viewingNemesisOrDuoSurfaceAsGhost }),
    );
  }, [isGhost, streakCurrent, pickCount, viewingNemesisOrDuoSurfaceAsGhost, dismissed, sheetOpen]);

  useEffect(() => {
    if (trigger && !shownFiredRef.current) {
      shownFiredRef.current = true;
      markShownToday();
      postAnalyticsEvent('claim_prompt_shown', { trigger });
    }
  }, [trigger]);

  const showBanner = Boolean(trigger) && !dismissed && !sheetOpen;

  return (
    <>
      {showBanner && trigger && (
        <div
          className="bg-surface text-paper fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 p-4 shadow-xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm sm:rounded-lg"
          data-testid="claim-prompt-engine"
          data-trigger={trigger}
        >
          <p className="text-sm">{CLAIM_NUDGE_COPY[trigger]}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="bg-side-a rounded px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => setSheetOpen(true)}
            >
              {CLAIM_PROMPT_CTA}
            </button>
            <button
              type="button"
              className="text-muted text-xs"
              onClick={() => setDismissed(true)}
              aria-label={CLAIM_PROMPT_DISMISS_LABEL}
            >
              {CLAIM_PROMPT_DISMISS_LABEL}
            </button>
          </div>
        </div>
      )}
      <ClaimSheet open={sheetOpen} onOpenChange={setSheetOpen} enabledProviders={enabledProviders} />
    </>
  );
}
