/**
 * Design-diff audit · `NemesisAssignmentCard` redesign — pure/presentational render coverage
 * (`renderToStaticMarkup`, this repo's convention for components with no DOM-interaction
 * library available; see `nemesis-head-to-head-banner.test.tsx`'s header for the precedent).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NemesisAssignmentCard } from '@/components/nemesis/NemesisAssignmentCard';
import type { PairingSide } from '@/lib/nemesis/types';

const OPPONENT: PairingSide = {
  profile_id: 'opp-1',
  handle: 'Maria O.',
  slug: 'maria-o',
  rating: { glicko_rating: 1550.4, glicko_rd: 80, games_count: 40, accuracy_percentile: 72 },
};

const BASE = { opponent: OPPONENT, isRematch: false, weekStart: '2026-07-13', sharedDayCount: 5, hasBonusQuestion: false };

describe('NemesisAssignmentCard', () => {
  it('shows the literal "VS" badge, never a score — assignment day is before any picks land', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} />);
    expect(html).toContain('>VS<');
    // No digit-dash-digit score pattern anywhere (that's the DIFFERENT, later verdict moment).
    expect(html).not.toMatch(/\d+–\d+/);
  });

  it('shows the opponent handle and rating', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} />);
    expect(html).toContain('Maria O.');
    expect(html).toContain('1550');
    expect(html).toContain('Top 28%');
  });

  it('formats week_start via the shared short-date convention, not a fabricated week number', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} />);
    expect(html).toContain('Week of Jul 13');
    expect(html).not.toMatch(/WEEK\s*\d+/i);
  });

  it('distinguishes the assignment vs. rematch eyebrow copy', () => {
    const assignment = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} />);
    const rematch = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} isRematch={true} />);
    expect(assignment).toContain('Assignment day');
    expect(rematch).toContain('Rematch day');
  });

  it('links "View matchup" to the private /nemesis/matchup route, not the public /vs/[pairingId] page', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} />);
    expect(html).toContain('href="/nemesis/matchup"');
    expect(html).not.toContain('/vs/');
  });

  it('links "Pause weeks" to the real /settings nemesis-pause toggle', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} />);
    expect(html).toContain('href="/settings"');
  });

  it('renders without a rating block when the opponent has no rating yet', () => {
    const html = renderToStaticMarkup(
      <NemesisAssignmentCard {...BASE} opponent={{ ...OPPONENT, rating: null }} />,
    );
    expect(html).not.toContain('rating');
  });

  it('renders one empty dot per shared day, real (not fabricated) bonus flag included', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} sharedDayCount={5} hasBonusQuestion />);
    expect(html.match(/rounded-full border-\[1\.5px\]/g)?.length).toBe(5);
    expect(html.toLowerCase()).toContain('bonus');
  });

  it('renders no day strip, and no bonus flag, when sharedDayCount is zero', () => {
    const html = renderToStaticMarkup(<NemesisAssignmentCard {...BASE} sharedDayCount={0} hasBonusQuestion />);
    expect(html).not.toContain('rounded-full border-[1.5px]');
    expect(html.toLowerCase()).not.toContain('bonus');
  });
});
