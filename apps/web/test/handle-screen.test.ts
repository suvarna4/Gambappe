import { describe, expect, it } from 'vitest';
import { screenCustomHandle } from '@/lib/handle-screen';
import { isProfaneHandle } from '@/lib/profanity';

describe('screenCustomHandle (§6.1.2)', () => {
  it('accepts a clean handle', () => {
    expect(screenCustomHandle('CoolFox_42')).toEqual({ ok: true });
  });

  it('rejects bad format', () => {
    expect(screenCustomHandle('ab')).toEqual({ ok: false, reason: 'format' });
    expect(screenCustomHandle('has space')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects reserved/impersonation terms (core denylist)', () => {
    expect(screenCustomHandle('kalshi_official')).toEqual({ ok: false, reason: 'reserved' });
    expect(screenCustomHandle('admin')).toEqual({ ok: false, reason: 'reserved' });
  });

  it('rejects profane terms, including simple leetspeak/separator evasion', () => {
    expect(isProfaneHandle('fuckthis')).toBe(true);
    expect(isProfaneHandle('f_u_c_k')).toBe(true);
    expect(screenCustomHandle('shitshow99')).toEqual({ ok: false, reason: 'profane' });
  });

  it('does not flag innocent substrings as profane', () => {
    expect(isProfaneHandle('classic')).toBe(false);
    expect(isProfaneHandle('scrapper')).toBe(false);
  });
});
