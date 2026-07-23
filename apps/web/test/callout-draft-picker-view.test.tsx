/**
 * XH-T7 presentational render coverage (docs/xtrace-hackathon-tasks.md) for
 * `CalloutDraftPickerView` — `renderToStaticMarkup` directly with an explicit `phase` prop, same
 * posture as `companion-banter-view.test.tsx` (XH-T6). The click-to-fetch/click-to-share steps
 * themselves are covered by `callout-draft-client.test.ts` (no jsdom in this repo — see that
 * file's header comment).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CalloutDraftPickerView,
  type CalloutDraftPhase,
} from '@/components/callouts/CalloutDraftButton';
import { calloutsCopy } from '@/lib/copy';

function render(phase: CalloutDraftPhase, selected = 0) {
  return renderToStaticMarkup(
    <CalloutDraftPickerView
      phase={phase}
      selected={selected}
      onSelect={vi.fn()}
      onDraftClick={vi.fn()}
      onShareClick={vi.fn()}
    />,
  );
}

describe('CalloutDraftPickerView (XH-T7)', () => {
  it('renders the "Draft it" button when idle', () => {
    const html = render({ kind: 'idle' });
    expect(html).toContain('data-testid="callout-draft-button"');
    expect(html).toContain(calloutsCopy.draftButtonLabel);
  });

  it('renders a disabled busy button while loading', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('data-testid="callout-draft-button"');
    expect(html).toContain('disabled');
    expect(html).toContain(calloutsCopy.sharing);
  });

  it('renders the drafts (up to COMPANION_DRAFT_MAX) as a picker once ready, with the hint and a share button', () => {
    const html = render({ kind: 'ready', drafts: ['line one', 'line two'] });
    expect(html).toContain('data-testid="callout-draft-picker"');
    expect(html).toContain(calloutsCopy.draftPickerHint);
    expect(html).toContain('line one');
    expect(html).toContain('line two');
    expect(html).toContain('data-testid="callout-draft-share-button"');
  });

  it("marks the selected draft's radio input as checked", () => {
    const html = render({ kind: 'ready', drafts: ['line one', 'line two'] }, 1);
    // Two radio inputs render; the second (index 1, "line two") must carry `checked`.
    const inputs = html.split('<input').slice(1);
    expect(inputs[0]).not.toContain('checked');
    expect(inputs[1]).toContain('checked');
  });

  it('renders the failure copy on error (the plain CalloutButton sibling is unaffected — separate component)', () => {
    const html = render({ kind: 'error' });
    expect(html).toContain('data-testid="callout-draft-error"');
    expect(html).toContain(calloutsCopy.draftFailed);
  });

  it('renders the shared "link copied" confirmation on success', () => {
    const html = render({ kind: 'copied' });
    expect(html).toContain('data-testid="callout-link-copied"');
    expect(html).toContain(calloutsCopy.linkCopied);
  });
});
