/**
 * XH-T6 presentational render coverage (docs/xtrace-hackathon-tasks.md) for
 * `CompanionBanterView` — `renderToStaticMarkup` directly, no DOM testing library, same
 * posture as `nemesis-components.test.tsx`'s `RematchPanel` coverage. The mount-effect fetch
 * (`CompanionBanter`'s `useEffect`) isn't exercised here — `renderToStaticMarkup` doesn't run
 * effects, and this repo has no jsdom/@testing-library; `fetchCompanionBanter` (the effect's
 * fetch step) has its own coverage in `companion-banter-client.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CompanionBanterView,
  type CompanionBanterState,
} from '@/components/companion/CompanionBanter';
import { companionCopy } from '@/lib/copy';

function render(state: CompanionBanterState): string {
  return renderToStaticMarkup(<CompanionBanterView state={state} />);
}

describe('CompanionBanterView (XH-T6)', () => {
  it('renders the loading copy while pending', () => {
    const html = render({ status: 'loading' });
    expect(html).toContain(companionCopy.loading);
  });

  it('renders nothing when hidden (degraded / null banter)', () => {
    const html = render({ status: 'hidden' });
    expect(html).toBe('');
  });

  it('renders the heading, lines, and disclaimer when ready', () => {
    const html = render({ status: 'ready', lines: ['line one', 'line two'] });
    expect(html).toContain(companionCopy.heading);
    expect(html).toContain('line one');
    expect(html).toContain('line two');
    expect(html).toContain(companionCopy.disclaimer);
  });
});
