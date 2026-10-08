# Streaming Service — Standalone NestJS + Kafka + Mediasoup (WebRTC)
# Build context: monorepo root
# NOTE: Mediasoup requires native bindings — build on same OS as runner
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/streaming-service/ ./services/streaming-service/
RUN pnpm install --frozen-lockfile --filter @ssl/streaming-service
RUN pnpm --filter @ssl/streaming-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl libc6-compat
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/streaming-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/streaming-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/streaming-service/package.json ./package.json
USER nestjs
EXPOSE 5008
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
