FROM node:24-alpine AS build
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/authorization/package.json packages/authorization/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN --mount=type=cache,id=abp-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm config set store-dir /pnpm/store && \
    pnpm --filter '!@abp/mobile' install --frozen-lockfile --fetch-retries=5 --fetch-timeout=300000
COPY . .
ENV npm_config_verify_deps_before_run=false
RUN node packages/database/node_modules/prisma/build/index.js generate --config packages/database/prisma.config.ts && \
    node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p packages/api-client/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p packages/authorization/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p packages/database/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
# Keep the already resolved workspace. Pruning after copying the mobile workspace
# would trigger a second install of native dependencies in this server image.

FROM node:24-alpine AS runtime
ENV NODE_ENV=production CI=true
RUN corepack enable
USER node
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace /workspace
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
