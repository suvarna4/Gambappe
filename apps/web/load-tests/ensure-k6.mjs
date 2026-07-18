#!/usr/bin/env node
/**
 * Preflight for the `load-test:*` pnpm scripts: k6 (design doc §17.1 "Load (k6, WS14-T2)") is a
 * Go binary, not an npm package — `pnpm install` alone will never provide it. This just gives a
 * clear, actionable error instead of the scenario scripts silently failing with an opaque
 * "k6: command not found" from the shell.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync('k6', ['version'], { stdio: 'ignore' });

if (result.error || result.status !== 0) {
  console.error(
    [
      '',
      'k6 is not installed (or not on PATH) — the WS14-T2 load-test scripts require the real k6',
      'CLI, not the "k6" npm package (that one is an unrelated autocomplete-only stub).',
      '',
      'Install one of:',
      '  - Go toolchain present:  go install go.k6.io/k6@latest   (installs to $(go env GOPATH)/bin)',
      '  - Debian/Ubuntu apt:      see https://grafana.com/docs/k6/latest/set-up/install-k6/',
      '  - Static binary:          https://github.com/grafana/k6/releases',
      '  - CI:                     grafana/setup-k6-action (GitHub Actions)',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
