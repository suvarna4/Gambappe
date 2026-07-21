'use client';

/**
 * WS20-T4 (journeys plan §5, D-J5) · The per-candidate "Call out" share button in the `/rivals`
 * hub's "Call someone out" panel. One tap: `POST /api/v1/callouts` mints a fresh challenge link
 * (claimed-only, WS20-T3), then the returned `share_url` is shared through the SAME primitive the
 * §10.5 share sheet uses for its copy-link path (`copyShareLink`, `lib/share-client.ts`) plus the
 * Web Share API when the device has it — reused, not reinvented (journeys plan §0 "reuse X"). No
 * free-text input anywhere (§5 AC): the only control is this button.
 *
 * The raw token rides only the `share_url` the POST returns; it is never persisted or logged here.
 * A device without `navigator.share` silently falls back to copying the link and confirming.
 */
import { useState } from 'react';
import { calloutsCopy } from '@/lib/copy';
import { copyShareLink } from '@/lib/share-client';

interface CalloutCreateResponseWire {
  data?: { share_url?: string };
  error?: { message?: string };
}

export interface CalloutButtonProps {
  candidateHandle: string;
}

type Phase = 'idle' | 'busy' | 'copied' | 'error';

export function CalloutButton({ candidateHandle }: CalloutButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');

  async function handleClick() {
    if (phase === 'busy') return;
    setPhase('busy');
    try {
      const res = await fetch('/api/v1/callouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as CalloutCreateResponseWire;
      const shareUrl = body.data?.share_url;
      if (!res.ok || !shareUrl) throw new Error(body.error?.message ?? 'callout create failed');

      const copied = await shareCalloutLink(shareUrl, `Call-out: ${candidateHandle}`);
      setPhase(copied ? 'copied' : 'idle');
    } catch {
      setPhase('error');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={phase === 'busy'}
        data-testid="callout-share-button"
        className="border-side-a text-side-a rounded border px-3 py-1.5 text-xs font-semibold tracking-wide uppercase disabled:opacity-50"
      >
        {phase === 'busy' ? calloutsCopy.sharing : calloutsCopy.shareCta}
      </button>
      {phase === 'copied' ? (
        <p className="text-muted text-xs" data-testid="callout-link-copied">
          {calloutsCopy.linkCopied}
        </p>
      ) : null}
      {phase === 'error' ? (
        <p className="text-loss text-xs" data-testid="callout-share-error">
          {calloutsCopy.shareError}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Native share (URL only) where available, else the shared clipboard fallback. Returns true when
 * the clipboard path was taken (so the caller shows the "link copied" confirmation) and false when
 * the OS share sheet handled it. A user dismissing the native sheet (AbortError) or any native
 * failure falls back to clipboard rather than surfacing an error.
 */
async function shareCalloutLink(url: string, title: string): Promise<boolean> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : undefined;
  if (nav?.share) {
    try {
      await nav.share({ url, title });
      return false;
    } catch {
      // fall through to clipboard
    }
  }
  await copyShareLink(url);
  return true;
}
