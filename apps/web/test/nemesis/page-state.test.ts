/**
 * Structural redesign of `/nemesis` (design-diff audit) — pure unit coverage for the
 * state-selection logic that decides which of the three mutually-exclusive states
 * (`assignment` / `verdict` / `empty`) the page renders. See `../../lib/nemesis/page-state.ts`'s
 * header for the full rationale.
 */
import { describe, expect, it } from 'vitest';
import { selectNemesisPageState } from '../../lib/nemesis/page-state';
import type { NemesisHistoryEntry, PairingPublic } from '../../lib/nemesis/types';

const PAIRING = { id: 'pairing-1' } as PairingPublic;

const OPPONENT = { profile_id: 'opp-1', handle: 'Opponent', slug: 'opponent' };

// `week_start: '2026-07-13'` is a Monday. That week's `nemesis:conclude` runs Sunday 2026-07-19
// 22:00 ET (2026-07-20T02:00:00Z, EDT) — `VERDICT_FRESH_WINDOW_MS` (8 days) keeps this entry's
// verdict state eligible through 2026-07-28T02:00:00Z.
const FRESH_AT = new Date('2026-07-22T12:00:00Z'); // a couple days after conclusion, inside the window
const TOO_EARLY_AT = new Date('2026-07-19T12:00:00Z'); // mid-week, before the week even concluded
const STALE_AT = new Date('2026-08-01T12:00:00Z'); // well past the 8-day window

// Branded id fields (`pairing_id`, `season_id`) accept a plain string only via a cast — same
// posture `nemesis-components.test.tsx` uses for `ProfileId` — so `overrides` stays loosely typed
// here rather than fighting the brand at every call site.
function historyEntry(overrides: Record<string, unknown> = {}): NemesisHistoryEntry {
  return {
    pairing_id: 'past-pairing-1',
    season_id: 'season-1',
    week_start: '2026-07-13',
    opponent: OPPONENT,
    my_score: 2,
    their_score: 1,
    outcome: 'win',
    is_rematch: false,
    rematch_request: null,
    ...overrides,
  } as NemesisHistoryEntry;
}

describe('selectNemesisPageState', () => {
  it('is "assignment" whenever there is an active pairing, regardless of history or time', () => {
    expect(
      selectNemesisPageState({ pairing: PAIRING, historyEntries: [], at: FRESH_AT }).kind,
    ).toBe('assignment');
    expect(
      selectNemesisPageState({
        pairing: PAIRING,
        historyEntries: [historyEntry()],
        at: STALE_AT,
      }).kind,
    ).toBe('assignment');
  });

  it('is "verdict" for the most recent history entry when there is no active pairing, it has a real outcome, and it is still inside its fresh window', () => {
    const entry = historyEntry({ outcome: 'loss' });
    const state = selectNemesisPageState({ pairing: null, historyEntries: [entry], at: FRESH_AT });
    expect(state.kind).toBe('verdict');
    expect(state.kind === 'verdict' && state.entry).toBe(entry);
  });

  it('promotes only the FIRST (newest) history entry, never an older one', () => {
    const newest = historyEntry({ pairing_id: 'newest', week_start: '2026-07-13' });
    const older = historyEntry({ pairing_id: 'older', week_start: '2026-07-06' });
    const state = selectNemesisPageState({
      pairing: null,
      historyEntries: [newest, older],
      at: FRESH_AT,
    });
    expect(state.kind === 'verdict' && state.entry.pairing_id).toBe('newest');
  });

  it('is "empty" when there is no active pairing and no history at all', () => {
    expect(
      selectNemesisPageState({ pairing: null, historyEntries: [], at: FRESH_AT }).kind,
    ).toBe('empty');
  });

  it('is "empty" (not "verdict") when the most recent entry is cancelled — a cancelled week never gets a verdict card', () => {
    const entry = historyEntry({ outcome: 'cancelled' });
    expect(
      selectNemesisPageState({ pairing: null, historyEntries: [entry], at: FRESH_AT }).kind,
    ).toBe('empty');
  });

  it('falls back to "empty" if the most recent entry is cancelled even when older entries have real outcomes — no reaching past the newest', () => {
    const cancelled = historyEntry({ pairing_id: 'newest', outcome: 'cancelled' });
    const olderWin = historyEntry({ pairing_id: 'older', outcome: 'win' });
    expect(
      selectNemesisPageState({
        pairing: null,
        historyEntries: [cancelled, olderWin],
        at: FRESH_AT,
      }).kind,
    ).toBe('empty');
  });

  it('is "empty" (not "verdict") once the fresh window has passed — a viewer who stopped qualifying for reassignment (dropped below NEMESIS_MIN_PICKS) must not see an old settled week presented as if it just happened, forever', () => {
    const entry = historyEntry({ outcome: 'win' });
    const state = selectNemesisPageState({ pairing: null, historyEntries: [entry], at: STALE_AT });
    expect(state.kind).toBe('empty');
  });

  it('is "empty" (not "verdict") before the week has even concluded — a defensive guard, since `pairing === null` should already be impossible mid-active-week, but the window math must not accidentally treat "too early" as "fresh"', () => {
    const entry = historyEntry({ outcome: 'win' });
    const state = selectNemesisPageState({
      pairing: null,
      historyEntries: [entry],
      at: TOO_EARLY_AT,
    });
    expect(state.kind).toBe('empty');
  });
});
