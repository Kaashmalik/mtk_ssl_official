# API Gateway — Standalone NestJS (no workspace deps)
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Root files needed for pnpm workspace resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Entire service directory (handles src, proto, tsconfig, nest-cli.json, etc.)
COPY services/api-gateway/ ./services/api-gateway/
RUN pnpm install --frozen-lockfile --filter @ssl/api-gateway
RUN pnpm --filter @ssl/api-gateway build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/api-gateway/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/api-gateway/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/api-gateway/package.json ./package.json
USER nestjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:3000/api/v1/health || exit 1
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
