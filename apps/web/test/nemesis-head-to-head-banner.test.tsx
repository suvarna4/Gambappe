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

  it('dims the loser\'s half off the authoritative outcome, not the raw scores — a tiebreak win still dims the right side even at an even score', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={2}
        opponentScore={2}
        outcome="won"
      />,
    );
    // Fixed by position (mockup's own scheme for this exhibit): viewer's half is always
    // side-a-tinted, opponent's is always side-b-tinted, regardless of who won.
    expect(html).toContain('bg-side-a/15');
    expect(html).toContain('bg-side-b/15');
    // The ONLY outcome-driven visual: the loser's whole half dialed down via opacity, the
    // winner's left untouched. Here the viewer won, so only the opponent's half carries the
    // dim class.
    const halves = html.match(/<div class="[^"]*flex-1[^"]*">/g) ?? [];
    expect(halves[0]).not.toContain('opacity-[0.55]');
    expect(halves[1]).toContain('opacity-[0.55]');
  });

  it('dims neither side for an actual draw', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={2}
        opponentScore={2}
        outcome="drew"
      />,
    );
    expect(html).not.toContain('opacity-[0.55]');
  });

  it('keeps the score badge structurally outside both wrapping handle spans, so a long handle can never clip the score away', () => {
    const html = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="A Genuinely Extremely Long Display Handle That Would Overflow"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
      />,
    );
    // The score lives in its own centered, absolutely-positioned badge element (`aria-hidden`) —
    // a long handle WRAPS to a second line (design-diff audit round 5, no ellipsis) rather than
    // overflowing into the badge's own space, so the badge's own markup never contains it.
    const badge = html.match(/<div aria-hidden="true"[^>]*>4–1<\/div>/);
    expect(badge).not.toBeNull();
    const handleSpan = html.match(/<span class="[^"]*break-words[^"]*">A Genuinely[^<]*<\/span>/);
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

  it('renders one dot per day result in the strip below the tug bar, and none when dayResults is omitted', () => {
    const withDots = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
        dayResults={['win', 'loss', 'neutral', 'pending', 'win']}
      />,
    );
    expect(withDots.match(/rounded-full border-2/g)?.length).toBe(5);

    const withoutDots = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
      />,
    );
    expect(withoutDots).not.toContain('rounded-full border-2');
  });

  it('renders the "Week of {date} / Verdict" eyebrow when weekStart is given, and omits it otherwise', () => {
    const withWeekStart = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
        weekStart="2026-07-13"
      />,
    );
    expect(withWeekStart).toContain('Week of Jul 13');
    expect(withWeekStart).toContain('Verdict');

    const withoutWeekStart = renderToStaticMarkup(
      <NemesisHeadToHeadBanner
        viewerHandle="You"
        opponentHandle="Them"
        viewerScore={4}
        opponentScore={1}
        outcome="won"
      />,
    );
    expect(withoutWeekStart).not.toContain('Week of');
  });
});
