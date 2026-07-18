/**
 * WS7-T3 reveal-moment choreography coverage for the `animated` opt-in on `Stamp`/`CrowdBar`
 * (§10.3). Uses `react-dom/server`'s `renderToStaticMarkup` directly, matching
 * `apps/web/test/question-state-view.test.tsx`'s pattern — no jsdom/@testing-library dependency
 * in this repo.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrowdBar } from '../src/components/CrowdBar.js';
import { Stamp } from '../src/components/Stamp.js';

describe('Stamp — animated (§10.3 "stamp slam")', () => {
  it('defaults to static: no animation utility, no motion-safe: class', () => {
    const html = renderToStaticMarkup(<Stamp variant="win" />);
    expect(html).not.toContain('motion-safe:');
    expect(html).not.toContain('animation:');
  });

  it('animated=true adds the motion-safe stamp-slam animation utility', () => {
    const html = renderToStaticMarkup(<Stamp variant="win" animated />);
    expect(html).toContain('motion-safe:[animation:stamp-slam_450ms_ease-out_1]');
  });
});

describe('CrowdBar — animated (§10.3 "crowd bar fill")', () => {
  it('defaults to static: fixed width, no animation utility or CSS var', () => {
    const html = renderToStaticMarkup(
      <CrowdBar yesCount={7} noCount={3} yesLabel="Yes" noLabel="No" />,
    );
    expect(html).not.toContain('motion-safe:');
    expect(html).not.toContain('--crowd-fill-target');
    expect(html).toContain('width:70%');
  });

  it('animated=true adds the fill animation utility and a per-side --crowd-fill-target var', () => {
    const html = renderToStaticMarkup(
      <CrowdBar yesCount={7} noCount={3} yesLabel="Yes" noLabel="No" animated />,
    );
    expect(html).toContain('motion-safe:[animation:crowd-fill_500ms_ease-out_200ms_1_both]');
    expect(html).toContain('--crowd-fill-target:70%');
    expect(html).toContain('--crowd-fill-target:30%');
  });
});
