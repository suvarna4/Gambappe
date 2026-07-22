/**
 * WS16-T3 · `TicketFrame` — the one card shell (journeys-plan §2). Pure presentational; uses
 * `renderToStaticMarkup` (repo pattern, no jsdom). Asserts the header/notches/perf/stub/tone
 * slots and the conditional positioning contract.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { TicketFrame } from '../src/components/TicketFrame.js';

describe('TicketFrame', () => {
  it('renders the ADMIT header with both slots and a 2px bottom rule + .22em tracking', () => {
    const html = renderToStaticMarkup(
      <TicketFrame header={{ left: 'GAMBAPPE', right: 'ADMIT ONE' }}>body</TicketFrame>,
    );
    expect(html).toContain('GAMBAPPE');
    expect(html).toContain('ADMIT ONE');
    expect(html).toContain('border-b-2');
    expect(html).toContain('tracking-[0.22em]');
  });

  it('omits the header entirely when not given one', () => {
    const html = renderToStaticMarkup(<TicketFrame>body</TicketFrame>);
    expect(html).not.toContain('border-b-2');
  });

  it('punches perf edges as a real mask cut-out only where requested', () => {
    // Each requested dot-edge is one `radial-gradient` layer, emitted twice (the standard
    // `mask-image` + the `-webkit-mask-image` fallback). No perf → no mask at all.
    const radials = (html: string) => (html.match(/radial-gradient/g) ?? []).length;
    expect(renderToStaticMarkup(<TicketFrame>b</TicketFrame>)).not.toContain('mask-image');
    const top = renderToStaticMarkup(<TicketFrame perf="top">b</TicketFrame>);
    expect(top).toContain('mask-composite');
    expect(radials(top)).toBe(2);
    expect(radials(renderToStaticMarkup(<TicketFrame perf="bottom">b</TicketFrame>))).toBe(2);
    expect(radials(renderToStaticMarkup(<TicketFrame perf="both">b</TicketFrame>))).toBe(4);
  });

  it('adds the two side notch cut-outs to the mask only when notches=true', () => {
    const off = renderToStaticMarkup(<TicketFrame>b</TicketFrame>);
    expect(off).not.toContain('mask-image');
    const on = renderToStaticMarkup(<TicketFrame notches>b</TicketFrame>);
    expect(on).toContain('mask-composite');
    // Left + right die-cut discs anchored at each side edge.
    expect(on).toContain('at 0% 50%');
    expect(on).toContain('at 100% 50%');
  });

  it('renders the tear-off stub with serial, dashed rule, and optional barcode', () => {
    const withBar = renderToStaticMarkup(
      <TicketFrame stub={{ serial: '№ 2026-07-19', barcode: true }}>b</TicketFrame>,
    );
    expect(withBar).toContain('№ 2026-07-19');
    expect(withBar).toContain('border-dashed');
    expect(withBar).toContain('repeating-linear-gradient');

    const noBar = renderToStaticMarkup(
      <TicketFrame stub={{ serial: 'S', barcode: false }}>b</TicketFrame>,
    );
    expect(noBar).not.toContain('repeating-linear-gradient');
  });

  it('defaults to the paper tone and switches surface classes for board', () => {
    const paper = renderToStaticMarkup(<TicketFrame>b</TicketFrame>);
    expect(paper).toContain('data-tone="paper"');
    expect(paper).toContain('bg-paper');
    const board = renderToStaticMarkup(<TicketFrame tone="board">b</TicketFrame>);
    expect(board).toContain('data-tone="board"');
    expect(board).toContain('bg-surface');
    expect(board).toContain('text-paper');
  });

  it('only claims `relative` when it has an overlay (the UnderCard position trap)', () => {
    // Notches are now mask cut-outs on the surface (no absolutely-positioned spans), so only an
    // overlay needs the positioning context.
    const bare = renderToStaticMarkup(<TicketFrame perf="both">b</TicketFrame>);
    expect(bare).not.toMatch(/class="relative/);
    const withNotches = renderToStaticMarkup(<TicketFrame notches>b</TicketFrame>);
    expect(withNotches).not.toMatch(/class="relative/);
    const withOverlay = renderToStaticMarkup(
      <TicketFrame overlay={<span data-testid="ov" />}>b</TicketFrame>,
    );
    expect(withOverlay).toContain('relative');
    expect(withOverlay).toContain('data-testid="ov"');
  });

  it('hides the frame from the a11y tree when ariaHidden', () => {
    const html = renderToStaticMarkup(<TicketFrame ariaHidden>b</TicketFrame>);
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders children in the body', () => {
    const html = renderToStaticMarkup(
      <TicketFrame>
        <span data-testid="child">hi</span>
      </TicketFrame>,
    );
    expect(html).toContain('data-testid="child"');
  });
});
