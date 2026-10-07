FROM node:24-alpine AS build
ENV CI=true \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
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
RUN node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p packages/api-client/tsconfig.json && \
    node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit && \
    cd apps/web && node node_modules/vite/bin/vite.js build

FROM nginxinc/nginx-unprivileged:1.29-alpine
ENV PORT=8080
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 apps/web/docker-entrypoint.d/40-abp-runtime-config.sh /docker-entrypoint.d/40-abp-runtime-config.sh
COPY --from=build --chown=nginx:nginx /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
