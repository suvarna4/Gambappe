'use client';

/**
 * The pre-auth half of the claim flow (design doc §6.3): the shared-device "this isn't me"
 * guard, then the Auth.js sign-in trigger (Google / email magic-link / X). Used both inline on
 * `/claim` (when no session exists yet) and inside the `ClaimSheet` overlay (opened from a claim
 * prompt or any other CTA elsewhere in the app).
 *
 * On open, fetches `GET /api/v1/me` to learn whether the visitor is currently a ghost (and, if
 * so, that ghost's handle/streak/pick count for the confirmation card) — §6.3: "the claim UI
 * first shows the ghost's handle and record... before deciding." An already-claimed session
 * (already fully claimed, case D) short-circuits straight to a "nothing to do" message. A 401
 * (fully anonymous — no ghost cookie, no session) skips the confirmation card entirely and goes
 * straight to sign-in.
 *
 * This component intentionally does NOT call `POST /api/v1/claim` itself — sign-in always
 * redirects through a full page navigation (OAuth) or an out-of-band email click, either of
 * which can lose this component's mounted state. The actual claim call happens once, from
 * `/claim`'s post-auth branch (`ClaimCompletion`), which is why every sign-in action redirects
 * to `/claim` regardless of where `ClaimEntry` was opened from.
 */
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { getMeResponseSchema } from '@receipts/core';
import type { AuthProviderId } from '@/lib/auth-providers';
import { markNotMe } from '@/lib/claim-not-me-flag';
import {
  CLAIM_CONFIRM_NOT_ME_LABEL,
  CLAIM_CONFIRM_YES_LABEL,
  CLAIM_PUBLICNESS_STATEMENT,
  CLAIM_SIGNIN_EMAIL_LABEL,
  CLAIM_SIGNIN_EMAIL_PLACEHOLDER,
  CLAIM_SIGNIN_EMAIL_SUBMIT_LABEL,
  CLAIM_SIGNIN_GOOGLE_LABEL,
  CLAIM_SIGNIN_HEADING,
  CLAIM_SIGNIN_SUBHEADING,
  CLAIM_SIGNIN_X_LABEL,
  CLAIM_ALREADY_CLAIMED,
  ghostConfirmationCopy,
} from '@/lib/copy';
import { signInWithEmail, signInWithGoogle, signInWithTwitter } from '@/app/claim/actions';

type MeResponse = z.infer<typeof getMeResponseSchema>;

type Phase = 'loading' | 'confirm-ghost' | 'signin' | 'already-claimed' | 'error';

export interface ClaimEntryProps {
  /** Which sign-in options to render (design doc §11.1: X may ship disabled). */
  enabledProviders?: AuthProviderId[];
  /** 'overlay': meant to sit inside a dismissible sheet. 'inline': normal page content (`/claim`). */
  presentation?: 'overlay' | 'inline';
}

export default function ClaimEntry({
  enabledProviders = ['google', 'email'],
  presentation = 'overlay',
}: ClaimEntryProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/me', { credentials: 'same-origin' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setPhase('signin');
          return;
        }
        const body = (await res.json()) as { data?: MeResponse; error?: { message: string } };
        if (!body.data) {
          setErrorMessage(body.error?.message ?? 'Failed to load your identity');
          setPhase('error');
          return;
        }
        setMe(body.data);
        if (body.data.claim.claimed) {
          setPhase('already-claimed');
        } else if (body.data.profile.kind === 'ghost') {
          setPhase('confirm-ghost');
        } else {
          setPhase('signin');
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message);
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // D-J8 (WS21-T1): 'inline' now renders on the /claim page's neutral paper TicketFrame — ink text
  // on cream (AA-safe), no card chrome of its own (the frame is the card), and NO gold on the ask.
  // 'overlay' keeps the dark dismissible-sheet look (that surface is WS21-T2's to restyle).
  const paper = presentation === 'inline';
  const containerClass = paper
    ? 'text-ink w-full space-y-4'
    : 'bg-surface text-paper w-full max-w-sm space-y-4 rounded-lg p-6 shadow-xl';
  const mutedText = paper ? 'text-ink/70' : 'text-muted';
  const primaryBtn = paper ? 'bg-ink text-paper' : 'bg-side-a text-white';
  const neutralBtn = paper ? 'border border-ink/25 bg-ink/[0.04] text-ink' : 'bg-bg';
  const inputClass = paper
    ? 'border border-ink/25 bg-transparent text-ink placeholder:text-ink/45'
    : 'bg-bg';

  if (phase === 'loading') {
    return (
      <div className={containerClass} data-testid="claim-entry" data-phase={phase}>
        <p className={`${mutedText} text-sm`}>Loading…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={containerClass} data-testid="claim-entry" data-phase={phase}>
        <p className="text-loss text-sm">{errorMessage}</p>
      </div>
    );
  }

  if (phase === 'already-claimed') {
    return (
      <div className={containerClass} data-testid="claim-entry" data-phase={phase}>
        <p className="text-sm">{CLAIM_ALREADY_CLAIMED}</p>
      </div>
    );
  }

  if (phase === 'confirm-ghost' && me && me.profile.kind === 'ghost') {
    return (
      <div className={containerClass} data-testid="claim-entry" data-phase={phase}>
        <p className="font-mono text-sm" data-testid="claim-ghost-confirmation">
          {ghostConfirmationCopy(me.profile.handle, me.profile.streak.current, me.eligibility.graded_picks)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={`${primaryBtn} rounded px-4 py-2 text-sm font-semibold`}
            onClick={() => setPhase('signin')}
          >
            {CLAIM_CONFIRM_YES_LABEL}
          </button>
          <button
            type="button"
            className={`${neutralBtn} rounded px-4 py-2 text-sm`}
            onClick={() => {
              markNotMe();
              setPhase('signin');
            }}
          >
            {CLAIM_CONFIRM_NOT_ME_LABEL}
          </button>
        </div>
      </div>
    );
  }

  // phase === 'signin'
  return (
    <div className={containerClass} data-testid="claim-entry" data-phase="signin">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{CLAIM_SIGNIN_HEADING}</h2>
        <p className={`${mutedText} text-sm`}>{CLAIM_SIGNIN_SUBHEADING}</p>
      </div>
      <p className={`${mutedText} text-xs`}>{CLAIM_PUBLICNESS_STATEMENT}</p>
      <div className="space-y-2">
        {enabledProviders.includes('google') && (
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className={`${neutralBtn} w-full rounded px-4 py-2 text-left text-sm font-semibold`}
            >
              {CLAIM_SIGNIN_GOOGLE_LABEL}
            </button>
          </form>
        )}
        {enabledProviders.includes('x') && (
          <form action={signInWithTwitter}>
            <button
              type="submit"
              className={`${neutralBtn} w-full rounded px-4 py-2 text-left text-sm font-semibold`}
            >
              {CLAIM_SIGNIN_X_LABEL}
            </button>
          </form>
        )}
        {enabledProviders.includes('email') && (
          <form action={signInWithEmail} className="flex gap-2">
            <input
              type="email"
              name="email"
              required
              placeholder={CLAIM_SIGNIN_EMAIL_PLACEHOLDER}
              className={`${inputClass} min-w-0 flex-1 rounded px-3 py-2 text-sm`}
              aria-label={CLAIM_SIGNIN_EMAIL_LABEL}
            />
            <button
              type="submit"
              className={`${primaryBtn} shrink-0 rounded px-3 py-2 text-sm font-semibold`}
            >
              {CLAIM_SIGNIN_EMAIL_SUBMIT_LABEL}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
