'use client';

/**
 * WS21-T2 (journeys plan §5, D-J8) · The `/you` ghost save row that fills WS22-T1's reserved
 * `you-save-row-slot`. Same neutral `SaveAskCard` the value-triggered nudge uses (record summary →
 * fact → Save), but INLINE on the record page rather than a dismissible fixed banner: on `/you` the
 * whole point of the room is "here's your record — save it", so the row is the primary, always-
 * present ask for a ghost. Renders nothing for a claimed viewer (nothing to save) or a fully
 * anonymous visitor (no record yet); the value signal comes from `GET /me` (`useSaveStatus`).
 *
 * The fact reuses WS21-T1's pinned nudge copy: the streak line when a streak exists, otherwise the
 * fingerprint line — never a new string here. The Save button links to `/claim?next={next}` so the
 * viewer lands back on `/you` after saving.
 */
import Link from 'next/link';
import { CLAIM_NUDGE_COPY, CLAIM_PROMPT_CTA, saveAskCopy } from '@/lib/copy';
import { useSaveStatus } from '@/lib/save-status';
import { SaveAskCard } from './SaveAskCard';

export interface SaveRowProps {
  /** Where the viewer returns after saving (default the room itself). */
  next?: string;
}

export function SaveRow({ next = '/you' }: SaveRowProps) {
  const status = useSaveStatus();
  // Claimed → nothing to save; anonymous (null) → no record on this device yet.
  if (!status || status.claimed) return null;

  const fact = status.streak > 0 ? CLAIM_NUDGE_COPY.streak : CLAIM_NUDGE_COPY.fingerprint;

  return (
    <SaveAskCard
      testId="you-save-row"
      recordSummary={saveAskCopy.recordLine(status.streak, status.gradedPicks)}
      fact={fact}
      actions={
        <Link
          href={`/claim?next=${encodeURIComponent(next)}`}
          data-testid="you-save-row-cta"
          className="bg-ink text-paper rounded px-4 py-1.5 text-sm font-semibold"
        >
          {CLAIM_PROMPT_CTA}
        </Link>
      }
    />
  );
}
