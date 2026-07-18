import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship compiled ESM; transpile keeps dev/HMR smooth.
  transpilePackages: ['@receipts/core', '@receipts/db', '@receipts/engine', '@receipts/ui'],
  // §16.2: no x-powered-by fingerprinting.
  poweredByHeader: false,
  // The runbooks route (§15.5, WS10-T5) reads docs/runbooks/*.md via fs at request time,
  // outside anything Next's import-based tracing would pick up on its own — without this,
  // a standalone/serverless build could ship without those files present.
  outputFileTracingIncludes: {
    '/api/admin/runbooks/[slug]': ['../../docs/runbooks/**'],
  },
};

export default nextConfig;
