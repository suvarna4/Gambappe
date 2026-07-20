/**
 * Design-diff gap fix · `NemesisHeadToHeadBanner` — pure/presentational render coverage
 * (`renderToStaticMarkup`, this repo's convention for components with no DOM-interaction
 * library available; see `verdict-card.test.tsx`'s header for the precedent).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NemesisHeadToHeadBanner } from '@/components/nemesis/NemesisHeadToHeadBanner';

describe('NemesisHeadToHeadBanner', () => {
  it('shows both handles and the score badge between them', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="Fox #4821"
        opponentHandle="Maria O."
        viewerScore={2}
        opponentScore={3}
        outcome="lost"
      />,
    );
    expect(html).toContain('Fox #4821');
    expect(html).toContain('Maria O.');
    expect(html).toContain('2–3');
  });

  it('renders a proportional bar split matching the score ratio (a 4-1 week is 80/20)', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
      />,
    );
    expect(html).toContain('width:80%');
    expect(html).toContain('width:20%');
  });

  it('falls back to an even 50/50 split when the combined score is zero (fully voided week)', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={0}
        opponentScore={0}
        outcome="drew"
      />,
    );
    expect(html.match(/width:50%/g)?.length).toBe(2);
  });

  it('colors the viewer/opponent bar segments off the authoritative outcome, not the raw scores — a tiebreak win keeps a real win/loss split even at an even score', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={2}
        opponentScore={2}
        outcome="won"
      />,
    );
    expect(html).toContain('bg-win');
    expect(html).toContain('bg-loss');
  });

  it('draws both segments muted for an actual draw', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={2}
        opponentScore={2}
        outcome="drew"
      />,
    );
    expect(html).not.toContain('bg-win');
    expect(html).not.toContain('bg-loss');
    // Muted renders on both the two half-card backgrounds ("bg-muted/15") and the two bar
    // segments ("bg-muted") — 4 occurrences of the class name total, none of them win/loss.
    expect(html.match(/bg-muted/g)?.length).toBe(4);
  });

  it('keeps the score badge structurally outside both truncating handle spans, so a long handle can never clip the score away', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="A Genuinely Extremely Long Display Handle That Would Overflow"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
      />,
    );
    // The score lives in its own centered badge element (`aria-hidden`, no `truncate` class),
    // never inside either handle's own `truncate` span — so a long handle clipping itself can
    // never clip the score along with it (the redesign's structural fix for the original
    // truncation-asymmetry bug: score and handle no longer share one flex row at all).
    const badge = html.match(/<div aria-hidden="true"[^>]*>4–1<\/div>/);
    expect(badge).not.toBeNull();
    expect(badge?.[0]).not.toContain('truncate');
    const handleSpan = html.match(/<span class="[^"]*truncate[^"]*">A Genuinely[^<]*<\/span>/);
    expect(handleSpan).not.toBeNull();
    expect(handleSpan?.[0]).not.toContain('4');
  });

  it('never asserts "edge" facts — score-margin framing only, matching VerdictCard\'s own pinned AC', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={2}
        opponentScore={3}
        outcome="lost"
      />,
    );
    expect(html.toLowerCase()).not.toContain('edge');
    expect(html.toLowerCase()).not.toContain('right ·');
  });
});
