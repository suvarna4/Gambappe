/**
 * Shared reader for `nemesis_pairings.verdict`'s per-side narration line
 * (docs/xtrace-hackathon-tasks.md XH-T5/XH-T8) — both `companion:ingest` (verdict prose fed to
 * xTrace) and `companion:season-recap` (chronological verdict lines fed to the recap prompt) read
 * the exact same jsonb shape `nemesis:conclude` writes; one reader keeps the two jobs from
 * silently drifting on what "narration" means.
 */
export interface VerdictNarration {
  narration?: Record<string, { line: string; emphasis: string | null } | undefined>;
}

export function ownNarrationLine(verdict: unknown, profileId: string): string | null {
  const parsed = verdict as VerdictNarration | null;
  return parsed?.narration?.[profileId]?.line ?? null;
}
