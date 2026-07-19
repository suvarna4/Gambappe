# Swipe UX accessibility audit (SW8-T1)

**Scope:** the swipe-ballot UX components (SW1/SW2/SW4/SW5) via the `/dev/ui` design-system
gallery, which renders every new component. Method: axe-core 4.12 (WCAG 2.0 A + AA tags) driven
in headless Chromium against the running gallery. Re-run with `apps/web/e2e/a11y.spec.ts`.

## Result

**Zero serious/critical axe violations across the swipe-UX components.** The audit caught and
fixed the color-contrast regressions listed below; the remaining findings are pre-existing and
out of this workstream's scope (see "Pre-existing").

### Contrast bugs caught and fixed

The dark-tuned `muted` token (#8B8B93) and the bright side/loss tokens (#3B82F6 / #F97316 /
#F43F5E) fail WCAG AA as **text on the paper card** (cream #F4F1E8). Fixed by using ink-at-70%
for muted labels and darkened on-paper inks for stamp text, keeping the bright borders for the
visual pop:

| Component                                              | Was                      | Now                   |
| ------------------------------------------------------ | ------------------------ | --------------------- |
| `BallotCard` eyebrow/venue rows                        | `text-muted`             | `text-ink/70`         |
| `UnderCard`                                            | `text-muted`             | `text-ink/70`         |
| `ReceiptSlip` (all labels)                             | `text-muted`             | `text-ink/70`         |
| `PriceTag` value (pre-existing WS7 motif)              | `text-side-a/b`          | `#1d4fa8` / `#b34d0a` |
| `NemesisFlip` / `DuoTandem` / `SwipeBallot` stamp text | `text-side-a/b`          | `#1d4fa8` / `#b34d0a` |
| `ObituaryCard` BUSTED stamp                            | `text-loss`              | `#a11731`             |
| `DuoTandem` MATCHED / SPLIT                            | `text-win` / `text-gold` | `#0b6b4f` / `#6b5200` |

All darkened inks clear AA (≈4.5–6.8:1 on cream). Side identity is preserved by the bright
border + dot (UI elements, AA at 3:1).

### Pre-existing (NOT introduced here — flagged for WS7/WS8)

`text-white` on `bg-side-a` (#3B82F6) button fills — the claim, share, and reveal-share buttons —
measure ~3.3:1, below AA for normal text. This is a design-system button-fill decision (darken
the fill to ~#1d4fa8, or enlarge/bolden), owned by those components, not the swipe UX. Left
as-is to avoid restyling shipped buttons under this task; recorded here so the owners can decide.

## Keyboard operability matrix (§2.3.7)

| Path                                   | How                                                                   | Verified                                                             |
| -------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Pick (pointer)                         | Drag the card past the 36% threshold                                  | SW1-T5 e2e (drag)                                                    |
| Pick (keyboard)                        | `Tab` to a well → `Enter`/`Space`; or `←`/`→` while a well is focused | wells are real `<button>`s; arrow handler on the wells (`onWellKey`) |
| Undo                                   | `Tab` to the printed undo link → `Enter`                              | real `<button>`, testid `undo-pick`                                  |
| Age gate                               | `Tab` to confirm/cancel → `Enter` (axis: cancel left, confirm right)  | real `<button>`s                                                     |
| Reactions / verdict / obituary actions | `Tab` → `Enter`                                                       | real `<button>`s, axis-ordered                                       |
| Focus visibility                       | `focus-visible` ring on the card; buttons keep the UA ring            | —                                                                    |

The card itself is a labelled `role="group"` drag surface (not a focusable custom widget) — the
wells are the keyboard/AT path, which is stronger than an arrow-key handler on a non-interactive
element (and jsx-a11y-clean). Screen readers get: the card group's `aria-label` naming both
sides, the receipt's `aria-live` print announcement, and implied-probability `aria-label`s on
every stamp/price ("63% implied", never the ¢ glyph alone).

## Reduced motion

Every animation added (nudge, drag transform, fling, spring-back, receipt print, reveal hush)
is gated on `prefers-reduced-motion`; under it the ballot renders transform-free and states swap
instantly. Covered by the SW1-T5 e2e reduced-motion run.
