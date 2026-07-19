#!/usr/bin/env node
/**
 * Side-axis order scan (D-SW9, `docs/swipe-ux-plan.md` §2.2 — SW2-T3).
 *
 * "The negative side lives on the left; the affirmative side lives on the right — everywhere,
 * always." Components render yes/no axis pairs by mapping over `SIDE_ORDER` / `sideAxisPair`
 * from `@receipts/ui` — never by hand-ordering the sides. This scan (same shape as
 * `check-dependency-denylist.mjs`, wired into `pnpm lint`) fails CI when any JSX/TSX source
 * contains a hand-ordered YES-first axis array literal (e.g. `['yes', 'no']`), so a future
 * component can't silently re-introduce a YES-left pair. `.ts` files are exempt on purpose:
 * non-rendering code (e.g. `packages/core`'s `MARKET_SIDE` enum tuple) orders sides by domain
 * convention, not visual gesture space — the rule is about rendered DOM order.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.git',
  'coverage',
  'test-results',
  'playwright-report',
]);

/** A YES-first axis pair array literal, any quote style, whitespace/newlines allowed. */
const YES_FIRST_PAIR = /\[\s*(['"`])yes\1\s*,\s*(['"`])no\2\s*\]/g;

/** Recursively find .tsx/.jsx sources, skipping dependency/build/output dirs. */
function findJsxFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) findJsxFiles(p, acc);
    else if (/\.(tsx|jsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

const violations = [];

for (const file of findJsxFiles(ROOT)) {
  const src = readFileSync(file, 'utf8');
  YES_FIRST_PAIR.lastIndex = 0;
  let m;
  while ((m = YES_FIRST_PAIR.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    violations.push(
      `${relative(ROOT, file)}:${line}: hand-ordered YES-first axis array — render the pair via SIDE_ORDER/sideAxisPair from @receipts/ui (D-SW9: NO left, YES right)`,
    );
  }
}

if (violations.length > 0) {
  console.error('Side-axis scan FAILED (D-SW9: NO left, YES right — swipe plan §2.2):');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('Side-axis scan passed (no hand-ordered YES-first axis arrays in JSX/TSX).');
