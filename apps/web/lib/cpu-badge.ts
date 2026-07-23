/**
 * WS26-T6 (docs/plans/cpu-nemesis-wbs.md): CPU-badge fields for profile refs. Every emitter
 * composing a `ProfileRef`-shaped object from a db `profiles` row spreads this in, so a CPU
 * rival can never render unbadged. Humans get `{}` — the fields stay absent, not false.
 */
import { CPU_PERSONA_LABELS, isCpuPersona } from '@receipts/core';

export interface CpuRefFields {
  is_cpu?: boolean;
  cpu_persona_label?: string | null;
}

export function cpuRefFields(profile: { kind: string; cpuPersona?: string | null }): CpuRefFields {
  if (profile.kind !== 'cpu') return {};
  const label =
    profile.cpuPersona && isCpuPersona(profile.cpuPersona)
      ? CPU_PERSONA_LABELS[profile.cpuPersona]
      : null;
  return { is_cpu: true, cpu_persona_label: label };
}
