import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship compiled ESM; transpile keeps dev/HMR smooth.
  transpilePackages: ['@receipts/core', '@receipts/db', '@receipts/ui'],
  // §16.2: no x-powered-by fingerprinting.
  poweredByHeader: false,
};

export default nextConfig;
