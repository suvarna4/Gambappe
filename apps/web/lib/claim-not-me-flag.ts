/**
 * Carries the shared-device guard's "This isn't me" decision (§6.3) across an Auth.js sign-in
 * redirect. The decision is made in `ClaimEntry` (pre-auth, while a ghost cookie might still be
 * shown to the visitor) but only usable once `POST /api/v1/claim` is called from `/claim`'s
 * post-auth branch — potentially after a full OAuth round trip away from and back to the
 * browser, or after a magic-link click from a different tab/app entirely, either of which loses
 * any in-memory React state. `sessionStorage` is the standard mechanism for this exact "preserve
 * one bit of UI intent across an external redirect" problem — it survives same-tab navigation
 * and is cleared automatically when the tab closes; this isn't specified by the design doc
 * (§6.3 doesn't mention client-side storage), so it's a WS7-T5 implementation decision, not a
 * pinned contract. A magic-link click-through that opens in a *new* tab loses this flag — in
 * that case the claim proceeds as case A/C (the more common expectation: "yes it's me") rather
 * than silently failing, since the flag's absence defaults to "not disclaimed."
 */
const STORAGE_KEY = 'rcpt_claim_not_me';

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function markNotMe(): void {
  storage()?.setItem(STORAGE_KEY, '1');
}

/** One-shot read: returns the flag's value and clears it, so a retry doesn't re-read stale intent. */
export function consumeNotMe(): boolean {
  const s = storage();
  const value = s?.getItem(STORAGE_KEY) === '1';
  s?.removeItem(STORAGE_KEY);
  return value;
}
