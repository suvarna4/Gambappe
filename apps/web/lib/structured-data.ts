/**
 * schema.org JSON-LD builders (design doc §19.3 WS8-T5 AC: "`/q` archive, structured data").
 * Pure/testable — pages `JSON.stringify` the return value into a `<script
 * type="application/ld+json">` tag themselves, since Next's `generateMetadata` return type has
 * no first-class structured-data field.
 *
 * `Article` (not `Question`/`Answer`) for a single question page: this product reports on a
 * crowd's call and a real-world outcome, not a canonical Q&A "accepted answer" — `Question`'s
 * schema.org semantics (answerCount, acceptedAnswer) don't fit and would misrepresent the crowd
 * split as an authoritative answer (INV-8 adjacent: no framing that looks like an odds/verdict
 * authority). `ItemList` for the archive is the standard schema.org type for a listing page.
 */
import type { ArchiveEntry } from './archive';

export interface QuestionJsonLdInput {
  headline: string;
  description: string;
  pageUrl: string;
  imageUrl?: string;
  datePublished: string;
  dateModified: string;
}

export function buildQuestionJsonLd(input: QuestionJsonLdInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: input.pageUrl,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
  };
}

export function buildArchiveJsonLd(origin: string, entries: readonly ArchiveEntry[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${origin}/q/${entry.slug}`,
      name: entry.headline,
    })),
  };
}
