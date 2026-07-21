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
import {
  CLAIM_NUDGE_COPY,
  CLAIM_PROMPT_CTA,
  CLAIM_PROMPT_DISMISS_LABEL,
  saveAskCopy,
  type ClaimNudgeTrigger,
} from '@/lib/copy';
import { postAnalyticsEvent } from '@/lib/analytics-client';
import { SaveAskCard } from '@/components/save/SaveAskCard';
import ClaimSheet from './ClaimSheet';

export interface ClaimPromptEngineProps extends ClaimPromptInput {
  enabledProviders?: AuthProviderId[];
}

export default function ClaimPromptEngine({ enabledProviders, ...input }: ClaimPromptEngineProps) {
  const [trigger, setTrigger] = useState<ClaimNudgeTrigger | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const shownFiredRef = useRef(false);

  const { isGhost, streakCurrent, pickCount, viewingNemesisOrDuoSurfaceAsGhost, incomingCallout } =
    input;

  useEffect(() => {
    if (dismissed || sheetOpen) return;
    setTrigger(
      evaluateClaimPrompt({
        isGhost,
        streakCurrent,
        pickCount,
        viewingNemesisOrDuoSurfaceAsGhost,
        incomingCallout,
      }),
    );
  }, [
    isGhost,
    streakCurrent,
    pickCount,
    viewingNemesisOrDuoSurfaceAsGhost,
    incomingCallout,
    dismissed,
    sheetOpen,
  ]);

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
        // Sits ABOVE the shell's fixed bottom tab bar (WS17-T1, `z-50`, ~4rem tall): the bar
        // reserves `pb-[calc(4rem+safe-area)]` on the content column, and if this card stayed at
        // `bottom-0` the bar would overlay it and swallow the CTA/dismiss clicks (the buttons became
        // untappable — Playwright's clicks hit `nav[data-testid=tab-bar]`). Offset by the bar height.
        //
        // WS21-T2 (D-J8): the nudge is now the neutral `SaveAskCard` (paper `TicketFrame`, no gold) —
        // record summary line → the WS21-T1 fact copy → Save + Not now (v3 artifact ch. 08-B). Save
        // opens the claim sheet; Not now dismisses (the 1/day cap already persisted on show).
        <div
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-4 sm:inset-x-auto sm:right-4 sm:bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:max-w-sm"
          data-testid="claim-prompt-engine"
          data-trigger={trigger}
        >
          <SaveAskCard
            testId="claim-prompt-card"
            recordSummary={saveAskCopy.recordLine(streakCurrent, pickCount)}
            fact={CLAIM_NUDGE_COPY[trigger]}
            actions={
              <>
                <button
                  type="button"
                  className="bg-ink text-paper rounded px-4 py-1.5 text-sm font-semibold"
                  onClick={() => setSheetOpen(true)}
                >
                  {CLAIM_PROMPT_CTA}
                </button>
                <button
                  type="button"
                  className="text-ink/70 text-sm underline underline-offset-2"
                  onClick={() => setDismissed(true)}
                  aria-label={CLAIM_PROMPT_DISMISS_LABEL}
                >
                  {CLAIM_PROMPT_DISMISS_LABEL}
                </button>
              </>
            }
          />
        </div>
      )}
      <ClaimSheet open={sheetOpen} onOpenChange={setSheetOpen} enabledProviders={enabledProviders} />
    </>
  );
}
