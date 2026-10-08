# Analytics Service — Standalone NestJS + Kafka + ClickHouse
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/analytics-service/ ./services/analytics-service/
RUN pnpm install --frozen-lockfile --filter @ssl/analytics-service
RUN pnpm --filter @ssl/analytics-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/analytics-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/analytics-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/analytics-service/package.json ./package.json
USER nestjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:5007/health || exit 1
EXPOSE 5007
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
