# Scoring Service — Workspace-dependent (@mtk/database) + WebSocket + Kafka
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Monorepo root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
# Workspace package (entire dir handles package.json, tsconfig, src, etc.)
COPY packages/database/ ./packages/database/
# Service source (entire dir handles src, tsconfig, nest-cli.json, instrument.ts, etc.)
COPY services/scoring-service/ ./services/scoring-service/
# Install all workspace deps + build
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mtk/database build
RUN pnpm --filter @ssl/scoring-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/scoring-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/scoring-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/scoring-service/package.json ./package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:4002/health || exit 1
EXPOSE 4002
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
