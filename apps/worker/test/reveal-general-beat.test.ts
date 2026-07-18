/**
 * WS9-T4 (§13.2 "Reveal at 8"): pure unit tests for `deriveGeneralRevealBeat`. DB-free, mirroring
 * `reveal-beats.test.ts`'s own convention.
 */
import { describe, expect, it } from 'vitest';
import { deriveGeneralRevealBeat } from '../src/notifications/reveal-general-beat.js';

describe('deriveGeneralRevealBeat (§13.2/§19.3 WS9-T4)', () => {
  it('produces a `reveal`-kind instruction with the §5.6/WS9-T1 dedupe-key convention', () => {
    const beat = deriveGeneralRevealBeat({ profileId: 'profile-1', questionDate: '2026-07-19' });
    expect(beat.kind).toBe('reveal');
    expect(beat.profileId).toBe('profile-1');
    expect(beat.dedupeKeyBase).toBe('reveal:2026-07-19:profile-1');
  });

  it('leaves payload.line/subject unset — relies on the reveal-category fallback template', () => {
    const beat = deriveGeneralRevealBeat({ profileId: 'profile-1', questionDate: '2026-07-19' });
    expect(beat.payload['line']).toBeUndefined();
    expect(beat.payload['subject']).toBeUndefined();
  });

  it('includes ctaUrl/ctaLabel when a deep link is supplied', () => {
    const beat = deriveGeneralRevealBeat({
      profileId: 'profile-1',
      questionDate: '2026-07-19',
      ctaUrl: 'https://receipts.example/q/2026-07-19-test',
    });
    expect(beat.payload['ctaUrl']).toBe('https://receipts.example/q/2026-07-19-test');
    expect(beat.payload['ctaLabel']).toBe('See the reveal');
  });

  it('omits ctaUrl/ctaLabel entirely when no deep link is supplied (never a blank href)', () => {
    const beat = deriveGeneralRevealBeat({ profileId: 'profile-1', questionDate: '2026-07-19' });
    expect('ctaUrl' in beat.payload).toBe(false);
    expect('ctaLabel' in beat.payload).toBe(false);
  });

  it('dedupe key varies by profile and by date (idempotent by construction, like reveal-beats.ts)', () => {
    const a = deriveGeneralRevealBeat({ profileId: 'profile-1', questionDate: '2026-07-19' });
    const b = deriveGeneralRevealBeat({ profileId: 'profile-1', questionDate: '2026-07-19' });
    expect(a.dedupeKeyBase).toBe(b.dedupeKeyBase);

    const otherProfile = deriveGeneralRevealBeat({ profileId: 'profile-2', questionDate: '2026-07-19' });
    expect(otherProfile.dedupeKeyBase).not.toBe(a.dedupeKeyBase);

    const otherDate = deriveGeneralRevealBeat({ profileId: 'profile-1', questionDate: '2026-07-20' });
    expect(otherDate.dedupeKeyBase).not.toBe(a.dedupeKeyBase);
  });
});
