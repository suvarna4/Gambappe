/**
 * SW3-T2 (swipe-ux-plan §2.6/§2.7): `Stamp` gains `foil`/`tape`/`punch` inks (CSS only) and
 * `CALLED IT` switches to the gold-foil ink — "the only gold motion in the product" (D-SW1
 * scarcity rule). Matches `reveal-motion.test.tsx`'s pattern: `renderToStaticMarkup`, no jsdom.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Stamp } from '../src/components/Stamp.js';

describe('Stamp — inks (§2.7 "four inks")', () => {
  it('rubber is the default ink for win/loss/pending, with the outcome hue', () => {
    const html = renderToStaticMarkup(<Stamp variant="win" />);
    expect(html).toContain('data-ink="rubber"');
    expect(html).toContain('border-win');
    expect(html).toContain('text-win');
  });

  it('called_it defaults to the foil ink', () => {
    const html = renderToStaticMarkup(<Stamp variant="called_it" />);
    expect(html).toContain('data-ink="foil"');
    expect(html).toContain('CALLED IT');
    // Foil overrides the win-hue border/text classes with the gold gradient treatment.
    expect(html).not.toContain('border-win');
    expect(html).not.toContain('text-win');
    expect(html).toContain('text-ink');
  });

  it('void defaults to the punch (outlined/dashed) ink', () => {
    const html = renderToStaticMarkup(<Stamp variant="void" />);
    expect(html).toContain('data-ink="punch"');
    expect(html).toContain('border-dashed');
  });

  it('ink can be overridden explicitly (e.g. tape for a non-outcome label)', () => {
    const html = renderToStaticMarkup(<Stamp variant="win" ink="tape" />);
    expect(html).toContain('data-ink="tape"');
    expect(html).toContain('bg-ink/85');
  });

  it('rotation is a fixed -7deg for every ink', () => {
    for (const variant of ['win', 'loss', 'void', 'called_it', 'pending'] as const) {
      const html = renderToStaticMarkup(<Stamp variant={variant} />);
      expect(html).toContain('-rotate-[7deg]');
    }
  });

  it('a stamp never animates twice in one view (animated is opt-in, off by default)', () => {
    const html = renderToStaticMarkup(<Stamp variant="called_it" />);
    expect(html).not.toContain('motion-safe:');
  });
});

// --- Grep test: foil used nowhere except called-it -----------------------------------------

const ROOT = new URL('../../..', import.meta.url).pathname;
// `test`/`e2e` excluded on purpose: this scan is about production call sites granting the foil
// ink, not test files asserting on rendered output (which legitimately contain the string
// `data-ink="foil"` as an expectation, not a prop grant).
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.git',
  'coverage',
  'test-results',
  'playwright-report',
  'test',
  'e2e',
]);
/** Only the Stamp component itself may bind an outcome to the foil ink — this is the file that
 * defines `called_it`'s default. Every other call site must reach foil (if at all) only through
 * that default, never by passing `ink="foil"` directly. `tokens.ts`/`print-shop.ts` additionally
 * exempt the gradient-hex scan below: they're the legitimate single-value origin of `colors.gold`
 * / `printShop.gold` (and `tokens.ts`'s doc comment cross-references the other file's value), not
 * a copy-pasted gradient. */
const ALLOWED_FOIL_FILES = new Set(['packages/ui/src/components/Stamp.tsx']);
const ALLOWED_GOLD_HEX_FILES = new Set([
  'packages/ui/src/components/Stamp.tsx',
  'packages/ui/src/tokens.ts',
  'apps/web/lib/og/print-shop.ts',
]);
/** An explicit `ink="foil"` (JSX prop, `ink={'foil'}`/`ink={"foil"}`) or `ink: 'foil'` (object/
 * spread-props form, e.g. `{...{ ink: 'foil' }}` or `createElement(Stamp, { ink: 'foil' })`) —
 * not just the word "foil" anywhere (docs/comments/headings are fine; an explicit grant is not)
 * and not `data-ink="foil"` (the rendered DOM attribute, matched with a negative lookbehind). */
const INK_FOIL_PROP = /(?<!data-)\bink\s*[:=]\s*(?:\{\s*)?["'`]foil["'`]/g;
/** The gold-gradient hex trio `Stamp.tsx`'s `foil` ink is built from — catches the gradient
 * being copy-pasted onto some other element (bypassing the `ink` prop, and this scan's own
 * `INK_FOIL_PROP` check, entirely). Requires at least 2 of the 3 hexes in one file: a single
 * hex alone is a legitimate lone gold-token definition (`tokens.ts`'s `colors.gold`,
 * `print-shop.ts`'s `printShop.gold`) — the gradient is only actually reproduced by the pair. */
const FOIL_GRADIENT_HEXES = [/#FFE9A8/i, /#FFC53D/i, /#B8860B/i];

function findSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) findSourceFiles(p, acc);
    else if (/\.(tsx|ts|jsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

describe('Stamp — foil is scarce (§2.7 AC: "foil used nowhere except called-it")', () => {
  it('no source file outside Stamp.tsx sets ink="foil" (prop or object-property form)', () => {
    const violations: string[] = [];
    for (const dir of ['packages/ui/src', 'apps/web']) {
      for (const file of findSourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split('\\').join('/');
        if (ALLOWED_FOIL_FILES.has(rel)) continue;
        const src = readFileSync(file, 'utf8');
        INK_FOIL_PROP.lastIndex = 0;
        if (INK_FOIL_PROP.test(src)) violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no source file outside Stamp.tsx reproduces the gold-foil gradient directly', () => {
    const violations: string[] = [];
    for (const dir of ['packages/ui/src', 'apps/web']) {
      for (const file of findSourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split('\\').join('/');
        if (ALLOWED_GOLD_HEX_FILES.has(rel)) continue;
        const src = readFileSync(file, 'utf8');
        const hexHits = FOIL_GRADIENT_HEXES.filter((re) => re.test(src)).length;
        if (hexHits >= 2) violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
