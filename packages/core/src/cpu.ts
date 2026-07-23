/**
 * CPU nemesis persona vocabulary (docs/plans/cpu-nemesis-wbs.md, WS26). Shared by the db
 * layer (persona stored on `kind='cpu'` profiles), the worker (`cpu:pick` sweep), and the
 * web badge — the pick *policies* themselves live in `@receipts/engine` (`decideCpuPick`).
 *
 * Deliberately NOT a Postgres enum: personas are stored as text and validated here, so the
 * roster can grow (rating-banded variants, WS26-T8/T9 refinement) without enum migrations.
 */

export const CPU_PERSONAS = ['chalk', 'fade', 'longshot', 'clock'] as const;
export type CpuPersona = (typeof CPU_PERSONAS)[number];

export function isCpuPersona(value: string): value is CpuPersona {
  return (CPU_PERSONAS as readonly string[]).includes(value);
}

/** Display labels for the badge/matchup surfaces (WS26-T6). */
export const CPU_PERSONA_LABELS: Record<CpuPersona, string> = {
  chalk: 'The Chalk',
  fade: 'The Fade',
  longshot: 'The Longshot',
  clock: 'The Clock',
};
