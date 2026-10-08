# Tournament Service — Workspace-dependent (@mtk/database) + gRPC + Kafka
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Monorepo root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
# Workspace packages
COPY packages/database/package.json ./packages/database/
COPY packages/database/tsconfig.json ./packages/database/
COPY packages/database/src ./packages/database/src/
# Service source (entire dir handles src, tsconfig, nest-cli.json, proto, etc.)
COPY services/tournament-service/ ./services/tournament-service/
# Install all workspace deps + build
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mtk/database build
RUN pnpm --filter @ssl/tournament-service build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/tournament-service/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/tournament-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/tournament-service/package.json ./package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
EXPOSE 5002
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
