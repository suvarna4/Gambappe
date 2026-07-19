/**
 * WS9-T1: the shared receipt-styled email layout — List-Unsubscribe headers, HTML escaping,
 * category-derived subjects/fallback copy, and the pre-rendered-`line` content contract.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@receipts/core';
import { renderNotificationEmail } from '../src/lib/notification-email-template.js';

const unsubscribeUrl = 'https://receipts.example/api/v1/notifications/unsubscribe?token=abc.def';

describe('renderNotificationEmail (§13.2 one shared receipt-styled layout)', () => {
  it('renders the pre-rendered narration line verbatim', () => {
    const rendered = renderNotificationEmail(
      'nemesis_verdict_win',
      { line: 'You read the week better than Fox #1234, 4–3. Rematch is open.' },
      { unsubscribeUrl },
    );
    expect(rendered.html).toContain('You read the week better than Fox #1234, 4–3. Rematch is open.');
    expect(rendered.text).toContain('You read the week better than Fox #1234, 4–3. Rematch is open.');
    expect(rendered.subject).toBe('Nemesis week update');
  });

  it('falls back to a generic per-category line when payload.line is absent', () => {
    const rendered = renderNotificationEmail('reveal', {}, { unsubscribeUrl });
    expect(rendered.html).toContain('The reveal is ready. Come see how it landed.');
    expect(rendered.subject).toBe("Tonight's reveal is in");
  });

  it('an unknown/future kind still renders (product fallback), never throws', () => {
    expect(() =>
      renderNotificationEmail('some_future_beat_nobody_has_wired_yet', {}, { unsubscribeUrl }),
    ).not.toThrow();
    const rendered = renderNotificationEmail('some_future_beat_nobody_has_wired_yet', {}, { unsubscribeUrl });
    expect(rendered.subject).toBe(`${PRODUCT_NAME} update`);
  });

  it('sets List-Unsubscribe + List-Unsubscribe-Post (RFC 8058 one-click)', () => {
    const rendered = renderNotificationEmail('streak_milestone', { line: 'x' }, { unsubscribeUrl });
    expect(rendered.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
    expect(rendered.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('HTML-escapes the narration line (no injection via payload content)', () => {
    const rendered = renderNotificationEmail(
      'called_it',
      { line: '<script>alert(1)</script> & "quoted"' },
      { unsubscribeUrl },
    );
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&amp;');
  });

  it('includes an optional CTA link when both ctaUrl and ctaLabel are present', () => {
    const rendered = renderNotificationEmail(
      'duo_formed',
      { line: 'x', ctaUrl: 'https://receipts.example/duos/abc', ctaLabel: 'View your duo' },
      { unsubscribeUrl },
    );
    expect(rendered.html).toContain('https://receipts.example/duos/abc');
    expect(rendered.html).toContain('View your duo');
    expect(rendered.text).toContain('https://receipts.example/duos/abc');
  });

  it('omits the CTA block entirely when not provided', () => {
    const rendered = renderNotificationEmail('duo_formed', { line: 'x' }, { unsubscribeUrl });
    expect(rendered.html).not.toContain('href=""');
  });

  it('an explicit payload.subject overrides the category default', () => {
    const rendered = renderNotificationEmail(
      'streak_busted',
      { line: 'x', subject: 'Custom subject' },
      { unsubscribeUrl },
    );
    expect(rendered.subject).toBe('Custom subject');
  });
});
