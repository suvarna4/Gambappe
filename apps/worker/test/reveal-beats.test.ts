/**
 * WS9-T3 (§13.3): pure unit tests for `deriveRevealBeats` — the beat-selection logic reveal:fire
 * hooks into. Deliberately DB-free (per the task's "favor unit-testing the beat-selection/dedupe-
 * key logic as pure-ish functions" guidance) so it's checkable without a live Postgres.
 */
import { describe, expect, it } from 'vitest';
import { deriveRevealBeats, type RevealBeatInput } from '../src/notifications/reveal-beats.js';

const base: RevealBeatInput = {
  profileId: 'profile-1',
  handle: 'shortstacker',
  questionDate: '2026-08-13',
  previousStreak: 0,
  currentStreak: 1,
  freezeUsedForGap: false,
  freezeBankAfter: 0,
  calledIt: false,
  impliedProbability: 0.5,
};

describe('deriveRevealBeats (§13.3)', () => {
  it('fires nothing for a plain, non-milestone, non-longshot participation', () => {
    expect(deriveRevealBeats(base)).toEqual([]);
  });

  it.each([3, 7, 14, 30] as const)('fires streak_milestone at n=%i', (n) => {
    const beats = deriveRevealBeats({ ...base, previousStreak: n - 1, currentStreak: n });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'streak_milestone', payload: { n } });
    expect(beats[0]!.dedupeKey).toBe(`streak_milestone:2026-08-13:profile-1`);
    expect(beats[0]!.line).toContain(String(n));
  });

  it('does not fire streak_milestone for a non-milestone streak length', () => {
    const beats = deriveRevealBeats({ ...base, previousStreak: 4, currentStreak: 5 });
    expect(beats).toEqual([]);
  });

  it('fires streak_busted when reset from >= 3 (previousStreak >= 3, currentStreak === 1)', () => {
    const beats = deriveRevealBeats({ ...base, previousStreak: 5, currentStreak: 1 });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'streak_busted', payload: { n: 5 } });
    expect(beats[0]!.dedupeKey).toBe(`streak_busted:2026-08-13:profile-1`);
  });

  it('does NOT fire streak_busted for a reset from < 3 (never had a real streak to bust)', () => {
    const beats = deriveRevealBeats({ ...base, previousStreak: 2, currentStreak: 1 });
    expect(beats).toEqual([]);
  });

  it('streak_busted and streak_milestone are mutually exclusive (bust always lands on 1, milestones start at 3)', () => {
    const beats = deriveRevealBeats({ ...base, previousStreak: 3, currentStreak: 1 });
    expect(beats.map((b) => b.kind)).toEqual(['streak_busted']);
  });

  it('fires streak_freeze_used when a freeze was newly consumed for this gap, with the post-consumption bank', () => {
    const beats = deriveRevealBeats({ ...base, freezeUsedForGap: true, freezeBankAfter: 1 });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'streak_freeze_used', payload: { freezesLeft: 1 } });
    expect(beats[0]!.dedupeKey).toBe(`streak_freeze_used:2026-08-13:profile-1`);
    expect(beats[0]!.line).toContain('1 left');
  });

  it('fires called_it for a longshot win, independent of streak state', () => {
    const beats = deriveRevealBeats({ ...base, calledIt: true, impliedProbability: 0.2 });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'called_it', payload: { impliedProbability: 0.2 } });
    expect(beats[0]!.dedupeKey).toBe(`called_it:2026-08-13:profile-1`);
    expect(beats[0]!.line).toContain('shortstacker');
  });

  it('multiple independent beats can co-fire off one reveal, each with its own dedupe key', () => {
    const beats = deriveRevealBeats({
      ...base,
      freezeUsedForGap: true,
      freezeBankAfter: 0,
      previousStreak: 2, // bridged gap day, then this reveal lands exactly on milestone 3
      currentStreak: 3,
      calledIt: true,
      impliedProbability: 0.1,
    });
    expect(beats.map((b) => b.kind).sort()).toEqual(['called_it', 'streak_freeze_used', 'streak_milestone'].sort());
    const dedupeKeys = new Set(beats.map((b) => b.dedupeKey));
    expect(dedupeKeys.size).toBe(beats.length); // all distinct
  });

  it('dedupe keys are deterministic and vary by beat/date/profile', () => {
    const a = deriveRevealBeats({ ...base, previousStreak: 2, currentStreak: 3 })[0]!;
    const b = deriveRevealBeats({ ...base, previousStreak: 2, currentStreak: 3 })[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey); // same inputs -> same key (idempotent by construction)

    const otherProfile = deriveRevealBeats({ ...base, profileId: 'profile-2', previousStreak: 2, currentStreak: 3 })[0]!;
    expect(otherProfile.dedupeKey).not.toBe(a.dedupeKey);

    const otherDate = deriveRevealBeats({ ...base, questionDate: '2026-08-14', previousStreak: 2, currentStreak: 3 })[0]!;
    expect(otherDate.dedupeKey).not.toBe(a.dedupeKey);
  });
});
