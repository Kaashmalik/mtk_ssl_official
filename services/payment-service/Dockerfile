# Payment Service — Standalone NestJS + gRPC + Stripe
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/payment-service/ ./services/payment-service/
RUN pnpm install --frozen-lockfile --filter @ssl/payment-service
RUN pnpm --filter @ssl/payment-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/payment-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/payment-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/payment-service/package.json ./package.json
USER nestjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:5004/health || exit 1
EXPOSE 5004
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
