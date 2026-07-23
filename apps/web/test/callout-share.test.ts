/**
 * XH-T7 unit (docs/xtrace-hackathon-tasks.md): `shareCalloutLink` (`@/lib/callout-share`) —
 * extracted out of `CalloutButton.tsx` so `CalloutDraftButton` can share the same path with
 * drafted text riding alongside the link. `navigator`/`navigator.clipboard` stubbed via
 * `vi.stubGlobal` (same style as `share-client.test.ts`'s `copyShareLink` coverage).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareCalloutLink } from '@/lib/callout-share';

describe('shareCalloutLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares { url, title } with no text field when no text is given (CalloutButton behavior unchanged)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    const copied = await shareCalloutLink('https://x/y', 'Call-out: Otter #9001');
    expect(share).toHaveBeenCalledWith({ url: 'https://x/y', title: 'Call-out: Otter #9001' });
    expect(copied).toBe(false);
  });

  it('shares { url, title, text } when text is given', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    await shareCalloutLink('https://x/y', 'Call-out: Otter #9001', 'you again? bring it');
    expect(share).toHaveBeenCalledWith({
      url: 'https://x/y',
      title: 'Call-out: Otter #9001',
      text: 'you again? bring it',
    });
  });

  it('falls back to plain-URL clipboard copy with no share API and no text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const copied = await shareCalloutLink('https://x/y', 'title');
    expect(writeText).toHaveBeenCalledWith('https://x/y');
    expect(copied).toBe(true);
  });

  it('falls back to "text url" clipboard copy when text is given and share is unsupported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await shareCalloutLink('https://x/y', 'title', 'you again? bring it');
    expect(writeText).toHaveBeenCalledWith('you again? bring it https://x/y');
  });

  it('falls back to clipboard when the native share sheet is dismissed (AbortError)', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    const copied = await shareCalloutLink('https://x/y', 'title', 'draft');
    expect(writeText).toHaveBeenCalledWith('draft https://x/y');
    expect(copied).toBe(true);
  });
});
