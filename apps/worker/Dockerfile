# apps/worker deploy image (§18: worker deploy = Docker image; Fly.io, 1 machine).
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter worker... --filter .
RUN pnpm --filter @receipts/config build || true
# Build EVERY workspace package the worker imports at runtime — `COPY packages` above brings
# in whatever dist/ happens to sit in the build context, and a package skipped here ships
# that stale (or missing) dist silently. WS15-T3: venues + engine were skipped, and a staging
# image quietly carried a pre-fix @receipts/venues dist over the freshly-merged source.
# XH-T5: @receipts/companion (companion-ingest.ts's xTrace/Claude client) was skipped the same
# way — added here once the auto-deploy build broke on it.
RUN pnpm --filter @receipts/core build \
  && pnpm --filter @receipts/db build \
  && pnpm --filter @receipts/engine build \
  && pnpm --filter @receipts/venues build \
  && pnpm --filter @receipts/companion build \
  && pnpm --filter worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
