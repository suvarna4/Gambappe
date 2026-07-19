/**
 * `/q` archive service layer (design doc §10.1: "`/q` (archive) | ISR daily | past questions
 * list | SEO surface (\"Will X happen? The crowd said 63%\")"), WS8-T5. Split from the route file
 * so the query + formatting logic is testable without Next's page/metadata machinery (mirrors
 * `lib/sitemap.ts`'s own rationale).
 */
import { countRevealedQuestionsForArchive, listRevealedQuestionsForArchive, type ArchiveQuestionRow, type Db } from '@receipts/db';

/**
 * A defensive cap, not a claim of proximity (mirrors `lib/sitemap.ts`'s `SITEMAP_ENTITY_CAP`
 * reasoning). At current/expected volume (~1 revealed daily question/day) a single capped page
 * is simplest and keeps this route free of Next's Dynamic APIs (no `searchParams`), so a literal
 * `revalidate` on the route actually behaves like real ISR instead of being forced into
 * per-request dynamic rendering. Revisit with real pagination if the archive's own length ever
 * becomes the bottleneck.
 */
export const ARCHIVE_ENTRY_CAP = 200;

export interface ArchiveEntry {
  slug: string;
  headline: string;
  description: string;
  revealedAt: string | null;
}

/** Mirrors `question-meta.ts`'s `describeQuestionState` `revealed` branch verbatim (design doc
 * §10.1's own "Will X happen? The crowd said 63%" archetype) — kept as a standalone formatter
 * rather than reusing `describeQuestionState` because `ArchiveQuestionRow` is a leaner DB
 * projection than the client-facing `QuestionPublic` shape (no price/lock-time fields an archive
 * listing doesn't need). */
export function describeArchiveOutcome(row: ArchiveQuestionRow): string {
  if (row.outcome === null) return `${row.headline} — the results are in.`;
  const outcomeLabel = row.outcome === 'yes' ? row.yesLabel : row.noLabel;
  if (row.crowdYesAtLock === null || row.crowdNoAtLock === null) {
    return `${outcomeLabel} — the results are in.`;
  }
  const total = row.crowdYesAtLock + row.crowdNoAtLock;
  const pctYes = total === 0 ? 0 : Math.round((row.crowdYesAtLock / total) * 100);
  return `${outcomeLabel}. The crowd said ${pctYes}% ${row.yesLabel}.`;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  /** True when `countRevealedQuestionsForArchive` exceeds `ARCHIVE_ENTRY_CAP` — surfaced so the
   * page can note "showing the most recent N" rather than silently truncating. */
  truncated: boolean;
}

export async function loadArchiveListing(db: Db): Promise<ArchiveListing> {
  const [rows, total] = await Promise.all([
    listRevealedQuestionsForArchive(db, ARCHIVE_ENTRY_CAP, 0),
    countRevealedQuestionsForArchive(db),
  ]);
  return {
    entries: rows.map((row) => ({
      slug: row.slug,
      headline: row.headline,
      description: describeArchiveOutcome(row),
      revealedAt: row.revealedAt ? row.revealedAt.toISOString() : null,
    })),
    truncated: total > ARCHIVE_ENTRY_CAP,
  };
}
