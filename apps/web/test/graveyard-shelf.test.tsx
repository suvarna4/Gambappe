/**
 * SW4-T3 · `GraveyardShelf` — broken streaks beside the trophies (P3). Presentational; wired to a
 * streak-history read in the DB-equipped session (see the component's SPEC-GAP note).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GraveyardShelf } from '@/components/GraveyardShelf';

describe('GraveyardShelf', () => {
  it('renders a headstone per broken streak plus the called-it trophy', () => {
    const html = renderToStaticMarkup(<GraveyardShelf ripDays={[11, 6, 3]} calledItCount={3} />);
    expect(html).toContain('RIP 11');
    expect(html).toContain('RIP 6');
    expect(html).toContain('RIP 3');
    expect(html).toContain('Called it ×3');
    expect((html.match(/data-testid="graveyard-rip"/g) ?? []).length).toBe(3);
  });

  it('shows the affectionate empty state when there is nothing yet', () => {
    const html = renderToStaticMarkup(<GraveyardShelf ripDays={[]} calledItCount={0} />);
    expect(html).toContain('No funerals yet.');
    expect(html).not.toContain('data-testid="graveyard-rip"');
  });

  it('shows graves even with no trophies (and vice versa)', () => {
    expect(renderToStaticMarkup(<GraveyardShelf ripDays={[4]} calledItCount={0} />)).not.toContain(
      'data-testid="graveyard-called-it"',
    );
    expect(renderToStaticMarkup(<GraveyardShelf ripDays={[]} calledItCount={2} />)).toContain(
      'Called it ×2',
    );
  });
});
