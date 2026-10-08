# Auth Service — Standalone NestJS + gRPC (no workspace deps)
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/auth-service/ ./services/auth-service/
RUN pnpm install --frozen-lockfile --filter @ssl/auth-service
RUN pnpm --filter @ssl/auth-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/auth-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/auth-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/auth-service/package.json ./package.json
USER nestjs
EXPOSE 5001
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
