/**
 * WS22-T1 · Unit tests for the profile stat components extracted from `/p/[slug]` and reused by
 * `/you` (journeys plan §5 WS22-T1 AC: "no forked stat markup"). Node env → static-markup
 * assertions. Pins: the header stat row (streak flame + accuracy + freeze note), the four-up stat
 * grid in both its real and `forming` (placeholder) states, and the topic bars derived from
 * `category_shares` (neutral, no gold — D-J8).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileHeaderStats } from '@/components/profile/ProfileHeaderStats';
import { ProfileStatGrid } from '@/components/profile/ProfileStatGrid';
import { ProfileTopicBars } from '@/components/profile/ProfileTopicBars';
import { topPercentDisplay } from '@/components/profile/format';

describe('topPercentDisplay', () => {
  it('renders "Top X%" with X = 100 − percentile, floored at 1', () => {
    expect(topPercentDisplay(95)).toBe('Top 5%');
    expect(topPercentDisplay(99.9)).toBe('Top 1%'); // never "Top 0%"
    expect(topPercentDisplay(40)).toBe('Top 60%');
  });
});

describe('ProfileHeaderStats', () => {
  it('shows accuracy + verified wallet, and omits the freeze note by default (byte-identical /p path)', () => {
    const html = renderToStaticMarkup(
      <ProfileHeaderStats
        currentStreak={4}
        freezeBank={2}
        accuracyPercentile={90}
        walletVerified
      />,
    );
    expect(html).toContain('Top 10% accuracy');
    expect(html).toContain('verified wallet');
    // Freeze note is opt-in (only `/you`); the public profile passes no `freezeNote`.
    expect(html).not.toContain('profile-freeze-note');
  });

  it('renders the freeze note on /you when there is a bank to note', () => {
    const html = renderToStaticMarkup(
      <ProfileHeaderStats
        currentStreak={0}
        freezeBank={3}
        accuracyPercentile={null}
        walletVerified={false}
        freezeNote
      />,
    );
    expect(html).toContain('data-testid="profile-freeze-note"');
    expect(html).toContain('3 freezes banked');
    // No accuracy caption when the percentile is null.
    expect(html).not.toContain('accuracy');
  });

  it('singularizes a one-freeze note', () => {
    const html = renderToStaticMarkup(
      <ProfileHeaderStats currentStreak={0} freezeBank={1} accuracyPercentile={null} walletVerified={false} freezeNote />,
    );
    expect(html).toContain('1 freeze banked');
  });
});

describe('ProfileStatGrid', () => {
  it('renders the real four-up stats including the "(best N)" streak template', () => {
    const html = renderToStaticMarkup(
      <ProfileStatGrid
        currentStreak={5}
        bestStreak={9}
        currentWinStreak={3}
        bestWinStreak={7}
        rating={1523.6}
        nemesis={{ wins: 2, losses: 1, draws: 0 }}
        badges={['called_it']}
      />,
    );
    expect(html).toContain('(best 9)'); // the streak dd template the golden-loop e2e keys on
    expect(html).toContain('(best 7)');
    expect(html).toContain('1524'); // rating rounded
    expect(html).toContain('2-1-0'); // nemesis record
    expect(html).toContain('CALLED IT'); // the called-it stamp shows
  });

  it('renders "—" for a null rating', () => {
    const html = renderToStaticMarkup(
      <ProfileStatGrid
        currentStreak={0}
        bestStreak={0}
        currentWinStreak={0}
        bestWinStreak={0}
        rating={null}
        nemesis={{ wins: 0, losses: 0, draws: 0 }}
        badges={[]}
      />,
    );
    expect(html).toContain('—');
    expect(html).toContain('0-0-0');
  });

  it('forming: every value is a "—" placeholder and no badges/records show', () => {
    const html = renderToStaticMarkup(
      <ProfileStatGrid
        forming
        currentStreak={5}
        bestStreak={9}
        currentWinStreak={3}
        bestWinStreak={7}
        rating={1500}
        nemesis={{ wins: 9, losses: 9, draws: 9 }}
        badges={['called_it']}
      />,
    );
    // Placeholders replace the real numbers — none of the seeded values leak through.
    expect(html).not.toContain('(best 9)');
    expect(html).not.toContain('9-9-9');
    expect(html).not.toContain('called_it');
    expect(html.match(/—/g)?.length).toBe(4); // one per stat cell
  });
});

describe('ProfileTopicBars', () => {
  it('draws a bar per positive share, largest first, with no gold', () => {
    const html = renderToStaticMarkup(
      <ProfileTopicBars shares={{ sports: 0.5, economics: 0.3, culture: 0 }} />,
    );
    expect(html).toContain('data-testid="topic-bar-sports"');
    expect(html).toContain('data-testid="topic-bar-economics"');
    // A zero share renders no bar.
    expect(html).not.toContain('data-testid="topic-bar-culture"');
    expect(html).toContain('50%');
    expect(html).toContain('30%');
    // Sports (0.5) sorts before Economics (0.3).
    expect(html.indexOf('topic-bar-sports')).toBeLessThan(html.indexOf('topic-bar-economics'));
    expect(html).not.toContain('gold'); // D-J8: gold is for wins
  });

  it('renders nothing when there is no share data', () => {
    expect(renderToStaticMarkup(<ProfileTopicBars shares={null} />)).toBe('');
    expect(renderToStaticMarkup(<ProfileTopicBars shares={{}} />)).toBe('');
  });
});
