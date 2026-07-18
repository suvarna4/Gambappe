/**
 * §6.2 step 1 `source` derivation — never client-supplied. Unit tests for the referer/header
 * heuristic (SPEC-GAP: real signed-token verification is WS8 scope, not built this wave).
 */
import { describe, expect, it } from 'vitest';
import { derivePickSource } from '@/lib/pick-source';

function req(headers: Record<string, string>): Request {
  return new Request('https://receipts.example/api/v1/questions/q-1/picks', { method: 'POST', headers });
}

describe('derivePickSource (§6.2 step 1)', () => {
  it('defaults to web with no signals', () => {
    expect(derivePickSource(req({}), 'world-cup-final')).toBe('web');
  });

  it('a share-token header → share_card', () => {
    expect(derivePickSource(req({ 'x-receipts-share-r': 'sometoken' }), 'world-cup-final')).toBe('share_card');
  });

  it('referer matching the question permalink → spectator_page', () => {
    const request = req({ referer: 'https://receipts.example/q/world-cup-final' });
    expect(derivePickSource(request, 'world-cup-final')).toBe('spectator_page');
  });

  it('referer for a DIFFERENT question is web, not spectator_page', () => {
    const request = req({ referer: 'https://receipts.example/q/other-question' });
    expect(derivePickSource(request, 'world-cup-final')).toBe('web');
  });

  it('a malformed referer never throws — falls back to web', () => {
    const request = req({ referer: 'not a url' });
    expect(derivePickSource(request, 'world-cup-final')).toBe('web');
  });

  it('share token takes priority over referer', () => {
    const request = req({
      'x-receipts-share-r': 'tok',
      referer: 'https://receipts.example/q/world-cup-final',
    });
    expect(derivePickSource(request, 'world-cup-final')).toBe('share_card');
  });
});
