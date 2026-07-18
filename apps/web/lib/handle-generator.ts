/**
 * Ghost handle generation (design doc §6.1.2): `{Animal} #{NNNN}`, NNNN 0001–9999, retry on
 * unique collision up to 20 tries, then widen to 5 digits (also up to 20 tries) before giving
 * up. Built on `packages/core/src/handles.ts`'s `ANIMALS`/`slugifyHandle` — this file is the
 * WS2-T1 generator itself.
 */
import { ANIMALS, slugifyHandle } from '@receipts/core';

const MAX_TRIES_PER_WIDTH = 20;

export interface HandleGeneratorDeps {
  /** Case-insensitive existence check (backed by `handleExists` in `@receipts/db`). */
  handleExists: (handle: string) => Promise<boolean>;
  /** Injectable RNG (0 ≤ x < 1) for deterministic collision-retry tests. */
  random?: () => number;
}

export interface GeneratedHandle {
  handle: string;
  slug: string;
}

function randomAnimal(random: () => number): string {
  const idx = Math.floor(random() * ANIMALS.length);
  return ANIMALS[Math.min(idx, ANIMALS.length - 1)]!;
}

function randomDigits(random: () => number, width: 4 | 5): string {
  const min = width === 4 ? 1 : 10_000;
  const max = width === 4 ? 9_999 : 99_999;
  const n = Math.min(max, Math.floor(random() * (max - min + 1)) + min);
  return String(n).padStart(width, '0');
}

export async function generateHandle(deps: HandleGeneratorDeps): Promise<GeneratedHandle> {
  const random = deps.random ?? Math.random;

  for (const width of [4, 5] as const) {
    for (let attempt = 0; attempt < MAX_TRIES_PER_WIDTH; attempt++) {
      const handle = `${randomAnimal(random)} #${randomDigits(random, width)}`;
       
      if (!(await deps.handleExists(handle))) {
        return { handle, slug: slugifyHandle(handle) };
      }
    }
  }

  throw new Error('generateHandle: exhausted retries at both 4- and 5-digit widths');
}
