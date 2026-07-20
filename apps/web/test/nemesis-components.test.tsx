/**
 * WS5-T5 pure/presentational render coverage for `RematchPanel`'s initial-state rendering —
 * same posture as `duo-components.test.tsx`: `renderToStaticMarkup` directly, no DOM testing
 * library (§10.4: "components must be pure/presentational (props in, DOM out)"). Interactive
 * behavior (request/accept/decline actually hitting the real API) is covered by
 * `e2e/nemesis-rematch.spec.ts` — this file only asserts that each `rematchRequest` prop shape
 * renders the correct initial affordance.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RematchPanel, type RematchState } from '@/components/nemesis/RematchPanel';

const VIEWER_ID = '018f1e2b-0000-7000-8000-0000000000v1';
const OPPONENT = { profile_id: '018f1e2b-0000-7000-8000-0000000000o1', handle: 'Otter #9001' };

function renderPanel(rematchRequest: RematchState | null): string {
  // `verdict: null` (as if this were a cancelled-outcome week) keeps these cases on the original
  // plain button/confirm-dialog flow — the SW10-T2 swipeable verdict-card branch has its own
  // coverage in `verdict-swipe-card.test.tsx`.
  return renderToStaticMarkup(
    <RematchPanel
      viewerProfileId={VIEWER_ID}
      opponent={OPPONENT}
      rematchRequest={rematchRequest}
      verdict={null}
    />,
  );
}

describe('RematchPanel (§8.4 step 0, §9.2)', () => {
  it('renders the "request rematch" button when no request exists yet', () => {
    const html = renderPanel(null);
    expect(html).toContain('Request rematch');
  });

  it('renders the pending label for an open OUTGOING request', () => {
    const html = renderPanel({ id: 'r1', direction: 'outgoing', status: 'open' });
    expect(html).toContain('Rematch requested');
    expect(html).toContain(OPPONENT.handle);
  });

  it('renders accept/decline for an open INCOMING request', () => {
    const html = renderPanel({ id: 'r1', direction: 'incoming', status: 'open' });
    expect(html).toContain(`${OPPONENT.handle} wants a rematch`);
    expect(html).toContain('Accept');
    expect(html).toContain('Decline');
  });

  it('renders the confirmed label for an accepted request, regardless of direction', () => {
    const outgoing = renderPanel({ id: 'r1', direction: 'outgoing', status: 'accepted' });
    const incoming = renderPanel({ id: 'r1', direction: 'incoming', status: 'accepted' });
    expect(outgoing).toContain('be paired starting next week');
    expect(incoming).toContain('be paired starting next week');
  });

  it('renders the declined label for a declined INCOMING request', () => {
    const html = renderPanel({ id: 'r1', direction: 'incoming', status: 'declined' });
    expect(html).toContain('Rematch declined');
  });

  it('falls back to the request button for a declined OUTGOING request (free to ask again)', () => {
    const html = renderPanel({ id: 'r1', direction: 'outgoing', status: 'declined' });
    expect(html).toContain('Request rematch');
  });
});
