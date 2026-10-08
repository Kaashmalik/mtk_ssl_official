# AI Commentary Service — Standalone NestJS + Kafka (no HTTP endpoint)
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ai-commentary-service/ ./services/ai-commentary-service/
RUN pnpm install --frozen-lockfile --filter @ssl/ai-commentary-service
RUN pnpm --filter @ssl/ai-commentary-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/ai-commentary-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/ai-commentary-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/ai-commentary-service/package.json ./package.json
USER nestjs
# No health check — Kafka-only consumer with no HTTP endpoint
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
