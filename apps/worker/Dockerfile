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
RUN pnpm --filter @receipts/core build && pnpm --filter @receipts/db build && pnpm --filter worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
