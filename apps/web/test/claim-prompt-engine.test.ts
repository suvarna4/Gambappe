import { describe, expect, it } from 'vitest';
import {
  CLAIM_PROMPT_PICK_THRESHOLD,
  CLAIM_PROMPT_STREAK_THRESHOLD,
  canShowToday,
  determineClaimPromptTrigger,
  evaluateClaimPrompt,
  todayKey,
  type ClaimPromptInput,
} from '@/lib/claim-prompt-engine';

const baseInput: ClaimPromptInput = {
  isGhost: true,
  streakCurrent: 0,
  pickCount: 0,
  viewingNemesisOrDuoSurfaceAsGhost: false,
};

class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('determineClaimPromptTrigger (§11.3 exact triggers)', () => {
  it('never triggers for a claimed profile, regardless of streak/picks', () => {
    expect(
      determineClaimPromptTrigger({ ...baseInput, isGhost: false, streakCurrent: 99, pickCount: 99 }),
    ).toBeNull();
  });

  it('no trigger below every threshold', () => {
    expect(determineClaimPromptTrigger(baseInput)).toBeNull();
  });

  it('streak reaching 3 triggers the streak nudge', () => {
    expect(
      determineClaimPromptTrigger({ ...baseInput, streakCurrent: CLAIM_PROMPT_STREAK_THRESHOLD }),
    ).toBe('streak');
    expect(determineClaimPromptTrigger({ ...baseInput, streakCurrent: 2 })).toBeNull();
  });

  it('5th pick (== NEMESIS_MIN_PICKS) triggers the fingerprint nudge', () => {
    expect(
      determineClaimPromptTrigger({ ...baseInput, pickCount: CLAIM_PROMPT_PICK_THRESHOLD }),
    ).toBe('fingerprint');
    expect(determineClaimPromptTrigger({ ...baseInput, pickCount: CLAIM_PROMPT_PICK_THRESHOLD - 1 })).toBeNull();
  });

  it('viewing a nemesis/duo surface as a ghost triggers the fingerprint nudge', () => {
    expect(
      determineClaimPromptTrigger({ ...baseInput, viewingNemesisOrDuoSurfaceAsGhost: true }),
    ).toBe('fingerprint');
  });

  it('WS21-T2: a pending incoming call-out triggers the fingerprint nudge (Save to get your nemesis)', () => {
    expect(determineClaimPromptTrigger({ ...baseInput, incomingCallout: true })).toBe('fingerprint');
    // and never for a claimed viewer, even with a call-out waiting.
    expect(
      determineClaimPromptTrigger({ ...baseInput, isGhost: false, incomingCallout: true }),
    ).toBeNull();
  });

  it('WS21-T2: streak still wins over an incoming call-out (time-sensitive loss-aversion first)', () => {
    expect(
      determineClaimPromptTrigger({
        ...baseInput,
        streakCurrent: CLAIM_PROMPT_STREAK_THRESHOLD,
        incomingCallout: true,
      }),
    ).toBe('streak');
  });

  it('streak trigger takes priority when both conditions hold', () => {
    expect(
      determineClaimPromptTrigger({
        ...baseInput,
        streakCurrent: CLAIM_PROMPT_STREAK_THRESHOLD,
        pickCount: CLAIM_PROMPT_PICK_THRESHOLD,
      }),
    ).toBe('streak');
  });
});

describe('todayKey / canShowToday (1/day cap)', () => {
  it('formats a stable YYYY-MM-DD key', () => {
    expect(todayKey(new Date('2026-07-18T23:59:00'))).toBe('2026-07-18');
    expect(todayKey(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05');
  });

  it('allows showing when nothing was shown yet', () => {
    expect(canShowToday(null, new Date('2026-07-18T12:00:00'))).toBe(true);
  });

  it('blocks a second show on the same day', () => {
    expect(canShowToday('2026-07-18', new Date('2026-07-18T23:00:00'))).toBe(false);
  });

  it('allows showing again on a new day', () => {
    expect(canShowToday('2026-07-17', new Date('2026-07-18T00:01:00'))).toBe(true);
  });
});

describe('evaluateClaimPrompt (trigger + cap combined)', () => {
  it('returns the trigger the first time today', () => {
    const storage = new FakeStorage();
    const now = new Date('2026-07-18T10:00:00');
    const result = evaluateClaimPrompt({ ...baseInput, streakCurrent: 3 }, now, storage);
    expect(result).toBe('streak');
  });

  it('is suppressed once already shown today, even if the trigger is still true', () => {
    const storage = new FakeStorage();
    storage.setItem('rcpt_claim_prompt_last_shown', '2026-07-18');
    const now = new Date('2026-07-18T18:00:00');
    expect(evaluateClaimPrompt({ ...baseInput, streakCurrent: 3 }, now, storage)).toBeNull();
  });

  it('fires again the next day', () => {
    const storage = new FakeStorage();
    storage.setItem('rcpt_claim_prompt_last_shown', '2026-07-17');
    const now = new Date('2026-07-18T00:05:00');
    expect(evaluateClaimPrompt({ ...baseInput, streakCurrent: 3 }, now, storage)).toBe('streak');
  });

  it('never fires with no trigger, regardless of the cap state', () => {
    const storage = new FakeStorage();
    expect(evaluateClaimPrompt(baseInput, new Date(), storage)).toBeNull();
  });
});
