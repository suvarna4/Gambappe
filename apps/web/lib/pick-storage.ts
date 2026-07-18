/**
 * Per-device "my pick on question X" cache (WS7-T2).
 *
 * SPEC-GAP(WS7-T2): §9.2's endpoint table has no read for "my pick on question X" that a
 * returning visitor's client island could call on page load — `GET /me` (§9.2) returns the
 * profile/settings/eligibility shape only (no current picks), and `GET /questions/:slug` is
 * deliberately viewer-free by contract (§10.2/INV-10: "Server render contains zero viewer
 * data"). The only place a pick's id/side/undo-deadline appears is the `POST .../picks` 201
 * response (§6.2 step 6) — which only the tab that made the call ever sees — and the
 * `ALREADY_PICKED` 409 body on a repeat POST (§6.2 step 5, "idempotent-friendly").
 *
 * Until WS3-T2 (or a follow-up) adds a dedicated read, this module caches the pick client-side
 * at the moment it's placed, keyed by question id, and clears it on undo. This is consistent
 * with the ghost identity model already being device-scoped (the `rcpt_gid` cookie itself is
 * device-scoped, §6.1.1) — a different device or a cleared cache just falls back to showing
 * pick buttons again, and a same-question re-pick attempt there would surface `ALREADY_PICKED`
 * (with the real pick echoed back), which `ViewerStrip` also uses to repair the cache
 * opportunistically. Never a source of truth for anything server-enforced (undo/lock checks
 * still hit the real endpoints, which independently re-verify via the DB clock, §6.2 step 3).
 */

export interface CachedPick {
  pickId: string;
  side: 'yes' | 'no';
  pickedAtIso: string;
  undoUntilIso: string;
}

function storageKey(questionId: string): string {
  return `receipts:pick:${questionId}`;
}

/** Minimal shape `window.localStorage` satisfies — lets tests pass an in-memory fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readCachedPick(storage: KeyValueStorage, questionId: string): CachedPick | null {
  try {
    const raw = storage.getItem(storageKey(questionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPick>;
    if (
      typeof parsed.pickId === 'string' &&
      (parsed.side === 'yes' || parsed.side === 'no') &&
      typeof parsed.pickedAtIso === 'string' &&
      typeof parsed.undoUntilIso === 'string'
    ) {
      return parsed as CachedPick;
    }
    return null;
  } catch {
    // Malformed/corrupt cache entry — treat exactly like "never picked", never throw.
    return null;
  }
}

export function writeCachedPick(
  storage: KeyValueStorage,
  questionId: string,
  pick: CachedPick,
): void {
  try {
    storage.setItem(storageKey(questionId), JSON.stringify(pick));
  } catch {
    // Storage full/unavailable (private browsing etc.) — the pick still succeeded server-side;
    // losing the local cache only means the receipt won't survive a reload. Non-fatal.
  }
}

export function clearCachedPick(storage: KeyValueStorage, questionId: string): void {
  try {
    storage.removeItem(storageKey(questionId));
  } catch {
    // Same non-fatal reasoning as above.
  }
}
