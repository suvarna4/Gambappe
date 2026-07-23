'use client';

/**
 * "Draft my callout" (docs/xtrace-hackathon-tasks.md XH-T7): AI-drafted trash-talk that rides
 * only the native share/clipboard payload next to the plain `CalloutButton` — the in-app callout
 * contract (stamps-only, no message field) is untouched. Rendered by `CalloutPanel` beside each
 * candidate's `CalloutButton` when the server passes `draftEnabled`; the two buttons are
 * independent siblings, so a draft failure here never affects the plain share flow next to it.
 *
 * Split into a pure presentational view (`CalloutDraftPickerView`) and this effectful wrapper, so
 * every phase is unit-testable via `renderToStaticMarkup` with explicit props — same posture as
 * `CompanionBanter.tsx` (XH-T6). The click-to-fetch and click-to-share steps themselves live in
 * `@/lib/companion/callout-draft-client` (fetch/share have no jsdom to click through in this
 * repo's test suite — see `callout-draft-client.test.ts`).
 */
import { useState } from 'react';
import { COMPANION_DRAFT_MAX } from '@receipts/core';
import { calloutsCopy } from '@/lib/copy';
import { createAndShareCallout, fetchCalloutDrafts } from '@/lib/companion/callout-draft-client';

export type CalloutDraftPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; drafts: string[] }
  | { kind: 'sharing'; drafts: string[] }
  | { kind: 'copied' }
  | { kind: 'error' };

export interface CalloutDraftPickerViewProps {
  phase: CalloutDraftPhase;
  selected: number;
  onSelect: (i: number) => void;
  onDraftClick: () => void;
  onShareClick: () => void;
}

export function CalloutDraftPickerView({
  phase,
  selected,
  onSelect,
  onDraftClick,
  onShareClick,
}: CalloutDraftPickerViewProps) {
  if (phase.kind === 'idle' || phase.kind === 'loading') {
    return (
      <button
        type="button"
        onClick={onDraftClick}
        disabled={phase.kind === 'loading'}
        data-testid="callout-draft-button"
        className="border-side-a text-side-a rounded border px-3 py-1.5 text-xs font-semibold tracking-wide uppercase disabled:opacity-50"
      >
        {phase.kind === 'loading' ? calloutsCopy.sharing : calloutsCopy.draftButtonLabel}
      </button>
    );
  }

  if (phase.kind === 'error') {
    return (
      <p className="text-loss text-xs" data-testid="callout-draft-error">
        {calloutsCopy.draftFailed}
      </p>
    );
  }

  if (phase.kind === 'copied') {
    return (
      <p className="text-muted text-xs" data-testid="callout-link-copied">
        {calloutsCopy.linkCopied}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1" data-testid="callout-draft-picker">
      <p className="text-muted text-xs">{calloutsCopy.draftPickerHint}</p>
      <ul className="space-y-1 text-xs">
        {phase.drafts.map((draft, i) => (
          <li key={i}>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="callout-draft"
                checked={selected === i}
                disabled={phase.kind === 'sharing'}
                onChange={() => onSelect(i)}
              />
              {draft}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onShareClick}
        disabled={phase.kind === 'sharing'}
        data-testid="callout-draft-share-button"
        className="border-side-a text-side-a rounded border px-3 py-1.5 text-xs font-semibold tracking-wide uppercase disabled:opacity-50"
      >
        {phase.kind === 'sharing' ? calloutsCopy.sharing : calloutsCopy.shareCta}
      </button>
    </div>
  );
}

export interface CalloutDraftButtonProps {
  candidateHandle: string;
  targetProfileId: string;
}

export function CalloutDraftButton({ candidateHandle, targetProfileId }: CalloutDraftButtonProps) {
  const [phase, setPhase] = useState<CalloutDraftPhase>({ kind: 'idle' });
  const [selected, setSelected] = useState(0);

  async function handleDraftClick() {
    setPhase({ kind: 'loading' });
    const drafts = await fetchCalloutDrafts(targetProfileId);
    if (!drafts || drafts.length === 0) {
      setPhase({ kind: 'error' });
      return;
    }
    setSelected(0);
    setPhase({ kind: 'ready', drafts: drafts.slice(0, COMPANION_DRAFT_MAX) });
  }

  async function handleShareClick() {
    if (phase.kind !== 'ready') return;
    const draft = phase.drafts[selected];
    if (draft === undefined) return;
    setPhase({ kind: 'sharing', drafts: phase.drafts });
    try {
      const copied = await createAndShareCallout(candidateHandle, draft);
      setPhase(copied ? { kind: 'copied' } : { kind: 'idle' });
    } catch {
      setPhase({ kind: 'error' });
    }
  }

  return (
    <CalloutDraftPickerView
      phase={phase}
      selected={selected}
      onSelect={setSelected}
      onDraftClick={() => void handleDraftClick()}
      onShareClick={() => void handleShareClick()}
    />
  );
}
