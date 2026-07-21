'use client';

/**
 * The post-auth half of the claim flow (design doc §6.3): once a session exists, calls
 * `POST /api/v1/claim`, handles the INV-9 age-attestation retry, and renders the case-specific
 * outcome (A/C: done; B: offer the placement flow per §8.7; D: no-op). Mounted only by
 * `/claim`'s server component, and only when `auth()` already returned a session — this is the
 * "post-auth landing" §6.3 describes.
 */
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { claimResponseSchema } from '@receipts/core';
import { consumeNotMe } from '@/lib/claim-not-me-flag';
import { postAnalyticsEvent } from '@/lib/analytics-client';
import {
  CLAIM_AGE_ATTEST_FOOTNOTE,
  CLAIM_AGE_ATTEST_HEADING,
  CLAIM_AGE_ATTEST_LABEL,
  CLAIM_AGE_ATTEST_SUBMIT_LABEL,
  CLAIM_GENERIC_ERROR,
  CLAIM_SUCCESS_CASE_B_CTA,
  CLAIM_SUCCESS_HEADING,
} from '@/lib/copy';

type ClaimResponse = z.infer<typeof claimResponseSchema>;
type Phase = 'submitting' | 'age-attest' | 'done' | 'error';

async function postClaim(body: { not_me?: true; age_attested?: true }): Promise<
  { ok: true; data: ClaimResponse } | { ok: false; code: string; message: string }
> {
  const res = await fetch('/api/v1/claim', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: ClaimResponse; error?: { code: string; message: string } };
  if (res.ok && json.data) return { ok: true, data: json.data };
  return { ok: false, code: json.error?.code ?? 'INTERNAL', message: json.error?.message ?? 'unknown error' };
}

export default function ClaimCompletion() {
  const [phase, setPhase] = useState<Phase>('submitting');
  const [notMe] = useState<boolean>(() => consumeNotMe());
  const [ageChecked, setAgeChecked] = useState(false);
  const [result, setResult] = useState<ClaimResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    postClaim(notMe ? { not_me: true } : {}).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setResult(res.data);
        setPhase('done');
        postAnalyticsEvent('claim_completed', { case: res.data.case });
      } else if (res.code === 'AGE_ATTESTATION_REQUIRED') {
        setPhase('age-attest');
      } else {
        setErrorMessage(res.message);
        setPhase('error');
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once on mount — `notMe` is captured once via the lazy `useState` initializer above,
    // so it's intentionally not a dependency here.
  }, []);

  async function confirmAgeAndClaim() {
    setPhase('submitting');
    const res = await postClaim({ ...(notMe ? { not_me: true } : {}), age_attested: true });
    if (res.ok) {
      setResult(res.data);
      setPhase('done');
      postAnalyticsEvent('claim_completed', { case: res.data.case });
    } else {
      setErrorMessage(res.message);
      setPhase('error');
    }
  }

  if (phase === 'submitting') {
    return (
      <div className="w-full space-y-4 text-ink" data-testid="claim-completion" data-phase={phase}>
        <p className="text-ink/70 text-sm">Finishing up…</p>
      </div>
    );
  }

  if (phase === 'age-attest') {
    return (
      <div className="w-full space-y-4 text-ink" data-testid="claim-completion" data-phase={phase}>
        <h2 className="text-lg font-bold">{CLAIM_AGE_ATTEST_HEADING}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ageChecked}
            onChange={(e) => setAgeChecked(e.target.checked)}
          />
          {CLAIM_AGE_ATTEST_LABEL}
        </label>
        <p className="text-ink/70 text-xs">{CLAIM_AGE_ATTEST_FOOTNOTE}</p>
        <button
          type="button"
          disabled={!ageChecked}
          onClick={confirmAgeAndClaim}
          className="bg-ink rounded px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40"
        >
          {CLAIM_AGE_ATTEST_SUBMIT_LABEL}
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="w-full space-y-4 text-ink" data-testid="claim-completion" data-phase={phase}>
        <p className="text-loss text-sm">{errorMessage ?? CLAIM_GENERIC_ERROR}</p>
      </div>
    );
  }

  // phase === 'done'
  return (
    <div className="w-full space-y-4 text-ink" data-testid="claim-completion" data-phase="done" data-case={result?.case}>
      <h2 className="text-lg font-bold">{CLAIM_SUCCESS_HEADING}</h2>
      {result && (
        <p className="font-mono text-sm">
          {result.profile.handle} · {result.profile.streak.current}-day streak
        </p>
      )}
      {result?.case === 'B' && (
        <a href="/placement" className="bg-ink inline-block rounded px-4 py-2 text-sm font-semibold text-paper">
          {CLAIM_SUCCESS_CASE_B_CTA}
        </a>
      )}
    </div>
  );
}
