/**
 * WS25-T3: the magic-link sign-in email — link inclusion, HTML escaping, and TTL-derived copy.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@receipts/core';
import { renderMagicLinkEmail } from '@/lib/auth-email-template';

describe('renderMagicLinkEmail', () => {
  it('includes the sign-in url in both html (entity-escaped) and text (verbatim)', () => {
    const url =
      'https://receipts.example/api/auth/callback/email?token=abc.def&callbackUrl=%2Fclaim';
    const rendered = renderMagicLinkEmail(url, 15);
    expect(rendered.html).toContain(
      'https://receipts.example/api/auth/callback/email?token=abc.def&amp;callbackUrl=%2Fclaim',
    );
    expect(rendered.text).toContain(url);
    expect(rendered.subject).toBe(`Sign in to ${PRODUCT_NAME}`);
  });

  it('states the actual TTL passed in, not a hardcoded value', () => {
    const rendered = renderMagicLinkEmail('https://receipts.example/verify', 30);
    expect(rendered.html).toContain('expires in 30 minutes');
    expect(rendered.text).toContain('expires in 30 minutes');
  });

  it('HTML-escapes a url containing special characters', () => {
    const url = 'https://receipts.example/verify?a=1&b=2"><script>alert(1)</script>';
    const rendered = renderMagicLinkEmail(url, 15);
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&amp;b=2');
  });
});
