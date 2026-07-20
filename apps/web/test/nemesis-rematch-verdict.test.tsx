/**
 * SW10-T2 · `RematchPanel`'s verdict-card wiring — the "no actionable existing request" terminal
 * state now renders `VerdictSwipeCard` (right-swipe/"Run it back" tap = `POST /rematch-requests`,
 * same posture as `nemesis-components.test.tsx`'s pure/presentational coverage of the OTHER
 * states, which are unaffected by this task). Interactive commit (the actual API call, the swipe
 * gesture) is covered by `e2e/nemesis-rematch.spec.ts`; this file only asserts which branch
 * renders for which `verdict` prop, and that a cancelled week never gets a verdict card.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RematchPanel, type RematchVerdict } from '@/components/nemesis/RematchPanel';

const VIEWER_ID = '018f1e2b-0000-7000-8000-0000000000v1';
const OPPONENT = { profile_id: '018f1e2b-0000-7000-8000-0000000000o1', handle: 'Otter #9001' };

function renderPanel(verdict: RematchVerdict | null): string {
  return renderToStaticMarkup(
    <RematchPanel viewerProfileId={VIEWER_ID} opponent={OPPONENT} rematchRequest={null} verdict={verdict} />,
  );
}

const wonVerdict: RematchVerdict = {
  outcome: 'won',
  youWins: 4,
  opponentWins: 1,
  scoreMargin: 3,
  dayResults: ['win', 'win', 'loss', 'win', 'neutral'],
};

const lostVerdict: RematchVerdict = { ...wonVerdict, outcome: 'lost', youWins: 1, opponentWins: 4 };

describe('RematchPanel × VerdictCard wiring (SW10-T2)', () => {
  it('renders the swipeable verdict card, not the plain button, when verdict is non-null', () => {
    const html = renderPanel(wonVerdict);
    expect(html).toContain('data-testid="verdict-card"');
    expect(html).toContain('data-testid="verdict-run-it-back"');
    expect(html).toContain('data-testid="verdict-new-fate"');
    expect(html).not.toContain('data-testid="rematch-request-button"');
  });

  it('right-swipe/"Run it back" sits after "New fate" in DOM order (D-SW9 affirmative-right axis)', () => {
    const html = renderPanel(lostVerdict);
    const newFateIdx = html.indexOf('data-testid="verdict-new-fate"');
    const runBackIdx = html.indexOf('data-testid="verdict-run-it-back"');
    expect(newFateIdx).toBeGreaterThanOrEqual(0);
    expect(runBackIdx).toBeGreaterThan(newFateIdx);
  });

  it('falls back to the original plain "Request rematch" button for a cancelled week (verdict: null)', () => {
    const html = renderPanel(null);
    expect(html).toContain('data-testid="rematch-request-button"');
    expect(html).not.toContain('data-testid="verdict-card"');
  });

  it("the loser card's copy is score-margin only — no edge wording", () => {
    const html = renderPanel(lostVerdict);
    expect(html.toLowerCase()).not.toContain('edge');
    expect(html).toContain('3 clear');
  });
});
