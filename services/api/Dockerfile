# Main API Service — Workspace-dependent (@mtk/database, @mtk/dns-provider)
# Build context: monorepo root
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Monorepo root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
# Workspace packages (entire dirs handle package.json, tsconfig, src, etc.)
COPY packages/database/ ./packages/database/
COPY packages/dns-provider/ ./packages/dns-provider/
# Service source (entire dir handles src, tsconfig, nest-cli.json, webpack.config.cjs, etc.)
COPY services/api/ ./services/api/
# Install all workspace deps + build
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mtk/database build
RUN pnpm --filter @mtk/dns-provider build
RUN pnpm --filter @mtk/api build

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini curl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/services/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/services/api/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages/dns-provider/dist ./packages/dns-provider/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/dns-provider/node_modules ./packages/dns-provider/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/api/package.json ./package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/dns-provider/package.json ./packages/dns-provider/package.json
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:4000/api/health || exit 1
EXPOSE 4000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
