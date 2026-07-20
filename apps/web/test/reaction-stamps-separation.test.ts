/**
 * SW10-T4 (wiring-gaps doc §4) AC: "PAIRING_REACTION_SET values never appear in
 * QuestionThread.tsx's picker and REACTION_SET's four emoji never appear in ReactionStamps'
 * picker (grep test)." Literal source-level grep, mirroring this doc's own audit methodology
 * (§2: "mechanical: grep for that component's name") — the two files' picker source must never
 * reference the other set's literal values, which is exactly the blast-radius risk `PAIRING_
 * REACTION_SET` was split out to avoid (a shared/extended `REACTION_SET` would have injected
 * these unlabeled text presets into every question-thread reaction picker site-wide).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAIRING_REACTION_SET, REACTION_SET } from '@receipts/core';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..', 'components');

function read(relativePath: string): string {
  return readFileSync(join(componentsDir, relativePath), 'utf8');
}

describe('reaction picker separation (grep test)', () => {
  it("QuestionThread.tsx's picker never references a PAIRING_REACTION_SET stamp", () => {
    const source = read('QuestionThread.tsx');
    for (const stamp of PAIRING_REACTION_SET) {
      expect(source).not.toContain(stamp);
    }
  });

  it("ReactionStamps.tsx's picker never references a REACTION_SET emoji", () => {
    const source = read('nemesis/ReactionStamps.tsx');
    for (const emoji of REACTION_SET) {
      expect(source).not.toContain(emoji);
    }
  });

  it('ReactionStampsPanel.tsx (the write-path wrapper) never references a REACTION_SET emoji either', () => {
    const source = read('nemesis/ReactionStampsPanel.tsx');
    for (const emoji of REACTION_SET) {
      expect(source).not.toContain(emoji);
    }
  });

  it('NemesisMatchupCard.tsx (the read-path mount) never references a REACTION_SET emoji', () => {
    const source = read('nemesis/NemesisMatchupCard.tsx');
    for (const emoji of REACTION_SET) {
      expect(source).not.toContain(emoji);
    }
  });
});
