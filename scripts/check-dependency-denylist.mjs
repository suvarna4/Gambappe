#!/usr/bin/env node
/**
 * Dependency denylist scan (design doc §17.3, INV-1).
 *
 * The product never holds money, routes orders, or takes positions — there must be no payment
 * or exchange-trading SDK anywhere in the dependency tree. This scan fails CI when any
 * package.json (dependency declarations) or the pnpm lockfile mentions a denylisted package.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Payment / exchange-trading SDK patterns (matched against package names, case-insensitive).
const DENYLIST = [
  /^stripe$/,
  /^@stripe\//,
  /^braintree/,
  /^@braintree\//,
  /^paypal/,
  /^@paypal\//,
  /^adyen/,
  /^@adyen\//,
  /^square$/,
  /^squareup$/,
  /^@square\//,
  /^plaid$/,
  /^razorpay$/,
  /^checkout-sdk-node$/,
  /^@checkout\.com\//,
  /^mollie/,
  /^@mollie\//,
  /^klarna/,
  /^coinbase/,
  /^@coinbase\//,
  /^binance/,
  /^node-binance-api$/,
  /^ccxt$/,
  /^kraken-api$/,
  /^@kraken\//,
  /^alpaca/,
  /^@alpacahq\//,
  /^ib-sdk$/, // Interactive Brokers
  /^robinhood/,
  /^kalshi.*(sdk|client|api)/, // venue *trading* clients; our read adapters are hand-rolled (§7)
  /^@polymarket\/clob-client$/, // Polymarket trading client — read-only REST only (§7.4)
];

/** Recursively find package.json files, skipping node_modules and build output. */
function findPackageJsons(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.next', '.turbo', '.git'].includes(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) findPackageJsons(p, acc);
    else if (entry === 'package.json') acc.push(p);
  }
  return acc;
}

const violations = [];

for (const file of findPackageJsons(ROOT)) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const declared = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  for (const name of Object.keys(declared)) {
    if (DENYLIST.some((re) => re.test(name.toLowerCase()))) {
      violations.push(`${relative(ROOT, file)}: declares denylisted dependency "${name}"`);
    }
  }
}

// Transitive coverage: scan the lockfile's package keys too.
const lockPath = join(ROOT, 'pnpm-lock.yaml');
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf8');
  // pnpm v9+ lockfile: packages are keyed as "  name@version:" or "  '@scope/name@version':"
  const keyRe = /^ {2}'?(@?[^\s'@][^\s':]*(?:\/[^\s':@]+)?)@[^:'\s]+'?:/gm;
  const seen = new Set();
  let m;
  while ((m = keyRe.exec(lock)) !== null) {
    const name = m[1].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    if (DENYLIST.some((re) => re.test(name))) {
      violations.push(`pnpm-lock.yaml: contains denylisted package "${name}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('Dependency denylist scan FAILED (INV-1: no payment/exchange-trading SDKs):');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('Dependency denylist scan passed (no payment/exchange-trading SDKs found).');
