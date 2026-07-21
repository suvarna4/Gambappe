'use client';

/**
 * WS21-T2 (journeys plan §5, D-J8) · The ambient Save chip that fills WS17-T1's `saveChipSlot` (the
 * ghost top-bar right slot). ONE word — "Save" — a NEUTRAL chip (dim border, never gold: gold is for
 * wins). It appears ONLY when there's value to lose (`hasSaveValue`: a ghost with a streak or ≥1
 * pick) and links to `/claim?next={current path}` so saving returns the viewer where they were.
 *
 * Data-light: the value signal is read client-side from `GET /me` (`useSaveStatus`), so mounting the
 * chip in the root layout does NOT make any page dynamic (seam 1 — `layout.tsx` stays static; the
 * slot just renders this self-contained client component).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CLAIM_PROMPT_CTA } from '@/lib/copy';
import { hasSaveValue, useSaveStatus } from '@/lib/save-status';

export function SaveChip() {
  const pathname = usePathname() ?? '/';
  const status = useSaveStatus();

  // Never on the Save screen itself; only when there's value to lose (AC).
  if (pathname.startsWith('/claim') || !hasSaveValue(status)) return null;

  return (
    <Link
      href={`/claim?next=${encodeURIComponent(pathname)}`}
      data-testid="save-chip"
      className="border-muted/60 bg-surface/90 text-paper hover:bg-surface m-3 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase backdrop-blur"
    >
      {CLAIM_PROMPT_CTA}
    </Link>
  );
}
