/**
 * WS9-T2: push payload rendering — category-derived title/fallback body, the pre-rendered-`line`
 * content contract (shared with `notification-email-template.ts`), and the ctaUrl → url mapping.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@receipts/core';
import { renderNotificationPush } from '../src/lib/notification-push-template.js';

describe('renderNotificationPush (§13.2)', () => {
  it('renders the pre-rendered narration line verbatim as the body', () => {
    const rendered = renderNotificationPush('nemesis_verdict_win', {
      line: 'You read the week better than Fox #1234, 4–3. Rematch is open.',
    });
    expect(rendered.body).toBe('You read the week better than Fox #1234, 4–3. Rematch is open.');
    expect(rendered.title).toBe('Nemesis week update');
  });

  it('falls back to a generic per-category body when payload.line is absent', () => {
    const rendered = renderNotificationPush('reveal', {});
    expect(rendered.body).toBe('The reveal is ready. Come see how it landed.');
    expect(rendered.title).toBe("Tonight's reveal is in");
  });

  it('an unknown/future kind still renders (product fallback), never throws', () => {
    expect(() => renderNotificationPush('some_future_beat_nobody_has_wired_yet', {})).not.toThrow();
    const rendered = renderNotificationPush('some_future_beat_nobody_has_wired_yet', {});
    expect(rendered.title).toBe(PRODUCT_NAME);
  });

  it('an explicit payload.subject overrides the category-default title', () => {
    const rendered = renderNotificationPush('streak_busted', {
      line: 'x',
      subject: 'Custom title',
    });
    expect(rendered.title).toBe('Custom title');
  });

  it('maps payload.ctaUrl to the push url, defaulting to "/" when absent', () => {
    const withCta = renderNotificationPush('duo_formed', { line: 'x', ctaUrl: '/duos/abc' });
    expect(withCta.url).toBe('/duos/abc');

    const withoutCta = renderNotificationPush('duo_formed', { line: 'x' });
    expect(withoutCta.url).toBe('/');
  });

  // SW7-T1: a daily-open push carries a `pick` descriptor → axis-ordered actions + SW `data`.
  it('emits axis-ordered pick actions + data when payload.pick is present', () => {
    const rendered = renderNotificationPush('daily_open', {
      line: 'Fed day. Cuts or holds?',
      ctaUrl: '/q/2026-07-19-fed',
      pick: { questionId: 'q_1', yesLabel: 'CUTS', noLabel: 'HOLDS' },
    });
    expect(rendered.actions).toEqual([
      { action: 'pick:no', title: '✕ HOLDS' },
      { action: 'pick:yes', title: 'CUTS ✓' },
    ]);
    expect(rendered.data).toEqual({
      url: '/q/2026-07-19-fed',
      questionId: 'q_1',
      yesLabel: 'CUTS',
      noLabel: 'HOLDS',
    });
  });

  it('a pick.url overrides ctaUrl for the SW deep-link data, without changing the tap url', () => {
    const rendered = renderNotificationPush('daily_open', {
      ctaUrl: '/',
      pick: { questionId: 'q_1', yesLabel: 'A', noLabel: 'B', url: '/q/today' },
    });
    expect(rendered.url).toBe('/');
    expect(rendered.data?.url).toBe('/q/today');
  });

  it('omits actions/data entirely for every non-pick beat (unchanged payload shape)', () => {
    const rendered = renderNotificationPush('reveal', { line: 'x' });
    expect(rendered.actions).toBeUndefined();
    expect(rendered.data).toBeUndefined();
  });

  it('ignores a malformed pick descriptor rather than emitting half-built actions', () => {
    const rendered = renderNotificationPush('daily_open', { line: 'x', pick: { yesLabel: 'A' } });
    expect(rendered.actions).toBeUndefined();
    expect(rendered.data).toBeUndefined();
  });
});
