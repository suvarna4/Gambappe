'use client';

/**
 * WS21-T2 (journeys plan §5, D-J8) · The ambient Save entry points' shared value signal. The Save
 * chip (top-bar slot) and the `/you` save row both need one fact: does this viewer have a record
 * worth saving? It's read once from `GET /api/v1/me` (ghost+, §9.2 — returns the streak, the graded
 * pick count, and whether the record is already claimed). The gating is a PURE function
 * (`hasSaveValue`) split out from the React hook so the "chip only when there's value to lose" AC is
 * unit-testable without a DOM or a network — mirrors the `claim-prompt-engine.ts` pure/adapter split.
 */
import { useEffect, useState } from 'react';

export interface SaveStatus {
  /** A claimed viewer has nothing left to save — the asks never render for them. */
  claimed: boolean;
  /** Participation streak (the headline thing to lose). */
  streak: number;
  /** Graded picks on this device (`eligibility.graded_picks`) — the other kind of value. */
  gradedPicks: number;
}

/**
 * AC "the chip appears only when there's value to lose": a ghost (not yet claimed) who has either a
 * live streak or at least one pick. A fully anonymous visitor (null status) never has value.
 */
export function hasSaveValue(status: SaveStatus | null): boolean {
  return status !== null && !status.claimed && (status.streak >= 1 || status.gradedPicks >= 1);
}

interface MeEnvelope {
  data?: {
    profile?: { streak?: { current?: number } };
    eligibility?: { graded_picks?: number };
    claim?: { claimed?: boolean };
  };
}

/** Map a `GET /me` success envelope (`{data}`) to the minimal save signal, or null if malformed. */
export function parseSaveStatus(body: unknown): SaveStatus | null {
  const data = (body as MeEnvelope | null)?.data;
  if (!data?.profile || !data.eligibility || !data.claim) return null;
  return {
    claimed: Boolean(data.claim.claimed),
    streak: data.profile.streak?.current ?? 0,
    gradedPicks: data.eligibility.graded_picks ?? 0,
  };
}

/**
 * Client hook: fetch `GET /me` once on mount. Anonymous visitors (no ghost cookie and no session)
 * get a 401 → status stays null → the asks render nothing. Never throws (same fire-and-forget
 * posture as `postAnalyticsEvent`): a failed `/me` just means no ambient Save ask this render.
 */
export function useSaveStatus(): SaveStatus | null {
  const [status, setStatus] = useState<SaveStatus | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (active) setStatus(parseSaveStatus(body));
      })
      .catch(() => {
        // Never load-bearing — swallow.
      });
    return () => {
      active = false;
    };
  }, []);
  return status;
}
