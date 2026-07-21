import { describe, expect, it } from 'vitest';
import { calloutsCopy } from '@/lib/copy';

/**
 * WS20-T4 (journeys plan §5, D-J5) · The `calloutsCopy` block (§7 seam 2: this task's only copy
 * block). Same INV-8 money-word rule every copy block is held to, plus the record-line phrasing
 * the grudge book depends on.
 */
describe('calloutsCopy', () => {
  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const strings = Object.values(calloutsCopy).map((v) =>
      typeof v === 'function' ? (v as (...a: number[]) => string)(2, 1) : v,
    );
    // Exercise the string-returning overloads that take a handle rather than numbers.
    strings.push(
      calloutsCopy.incomingBody('Otter #9001'),
      calloutsCopy.acceptedLine('Otter #9001'),
      calloutsCopy.lockedInLine('Otter #9001'),
      calloutsCopy.rematchPendingLine('Otter #9001'),
      calloutsCopy.rematchIncomingLine('Otter #9001'),
    );
    expect(strings.join(' ')).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });

  it('grudgeRecordLine reads "you lead" / "they lead" / "even" by margin (§5: "they lead 2–1")', () => {
    expect(calloutsCopy.grudgeRecordLine(3, 1)).toBe('you lead 3–1');
    expect(calloutsCopy.grudgeRecordLine(1, 2)).toBe('they lead 2–1');
    expect(calloutsCopy.grudgeRecordLine(2, 2)).toBe('even 2–2');
  });

  it('the incoming tape label is the pinned "YOU\'VE BEEN CALLED OUT" (journeys plan §2)', () => {
    expect(calloutsCopy.incomingTapeLabel).toBe("YOU'VE BEEN CALLED OUT");
  });

  it('the grudge rematch affordance is surfaced as the REMATCH stamp (§5)', () => {
    expect(calloutsCopy.rematchCta).toBe('REMATCH');
  });
});
