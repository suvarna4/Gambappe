import { describe, expect, it } from 'vitest';
import { buildArchiveJsonLd, buildQuestionJsonLd } from '../lib/structured-data';

describe('buildQuestionJsonLd', () => {
  it('builds an Article, not a Question/Answer type (no accepted-answer framing)', () => {
    const jsonLd = buildQuestionJsonLd({
      headline: 'Will it rain tomorrow?',
      description: 'Locked. Reveal at 5:00 PM ET.',
      pageUrl: 'https://example.com/q/will-it-rain',
      datePublished: '2026-07-19T13:00:00.000Z',
      dateModified: '2026-07-19T17:00:00.000Z',
    });

    expect(jsonLd['@type']).toBe('Article');
    expect(jsonLd['headline']).toBe('Will it rain tomorrow?');
    expect(jsonLd['mainEntityOfPage']).toBe('https://example.com/q/will-it-rain');
    expect(jsonLd['image']).toBeUndefined();
  });

  it('includes image only when an imageUrl is provided', () => {
    const jsonLd = buildQuestionJsonLd({
      headline: 'X',
      description: 'Y',
      pageUrl: 'https://example.com/q/x',
      imageUrl: 'https://example.com/api/og/question/x?v=abc',
      datePublished: '2026-07-19T13:00:00.000Z',
      dateModified: '2026-07-19T17:00:00.000Z',
    });
    expect(jsonLd['image']).toEqual(['https://example.com/api/og/question/x?v=abc']);
  });
});

describe('buildArchiveJsonLd', () => {
  it('builds an ItemList with 1-indexed positions and absolute URLs', () => {
    const jsonLd = buildArchiveJsonLd('https://example.com', [
      { slug: 'a', headline: 'A', description: 'a desc', revealedAt: null },
      { slug: 'b', headline: 'B', description: 'b desc', revealedAt: null },
    ]);

    expect(jsonLd['@type']).toBe('ItemList');
    const items = jsonLd['itemListElement'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: 'https://example.com/q/a',
      name: 'A',
    });
    expect(items[1]!['position']).toBe(2);
  });

  it('returns an empty itemListElement for an empty archive', () => {
    const jsonLd = buildArchiveJsonLd('https://example.com', []);
    expect(jsonLd['itemListElement']).toEqual([]);
  });
});
