/**
 * SW3-T1 (docs/swipe-ux-plan.md §2.6 F1 hush). The T-10s trigger math itself is covered
 * exhaustively as a pure function in format.test.ts (`isHushWindow`) — mirrors this repo's
 * existing pattern of testing `CountdownTicker`'s ticking logic via `countdownParts`/
 * `formatCountdown` rather than the live component, since `renderToStaticMarkup` never runs
 * effects (no jsdom/@testing-library in this repo). This test covers what IS observable from a
 * single synchronous render: the hush latch only ever flips via a client-only effect, so even a
 * target already inside the T-10s window renders as a plain passthrough on the first pass —
 * matching the real SSR→hydrate boundary for this `'use client'` component.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevealHush } from '../src/components/RevealHush.js';

describe('RevealHush', () => {
  it('passes children through unchanged on the pre-effect (SSR/initial) render, even inside the T-10s window', () => {
    const html = renderToStaticMarkup(
      <RevealHush
        targetIso={new Date(Date.now() + 5_000).toISOString()}
        frozenLabel="FROZEN"
        roomCountText="42 in the room"
      >
        <p>stage content</p>
      </RevealHush>,
    );
    expect(html).toBe('<p>stage content</p>');
    expect(html).not.toContain('reveal-hush');
  });
});
