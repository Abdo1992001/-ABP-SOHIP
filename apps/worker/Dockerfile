FROM node:24-bookworm-slim AS build
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /workspace
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*
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
    node node_modules/typescript/bin/tsc -p packages/database/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.json
# Native mobile dependencies are not needed by this runtime; do not re-resolve
# the workspace after copying application sources.

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates chromium-headless-shell fonts-dejavu-core openssl && \
    rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CI=true ABP_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-headless-shell
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace /workspace
USER node
CMD ["node", "apps/worker/dist/main.js"]
