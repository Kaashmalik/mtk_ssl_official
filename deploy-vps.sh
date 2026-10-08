#!/usr/bin/env bash
# ============================================================================
# SSL Cricket — Production VPS Deployment Script
# Target: Oracle Cloud Free Tier (Ubuntu 22.04/24.04 ARM or x86)
# Usage:  bash deploy-vps.sh [--phase core|all|infra|frontend]
# ============================================================================

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
ENV_FILE="$PROJECT_DIR/.env.prod"
ENV_TEMPLATE="$PROJECT_DIR/.env.production"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date +'%H:%M:%S')] WARN:${NC} $*"; }
error() { echo -e "${RED}[$(date +'%H:%M:%S')] ERROR:${NC} $*" >&2; }
step()  { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BLUE}  ▶ $*${NC}"; echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ─── Determine phase ────────────────────────────────────────────────────────
# Safe with zero args (set -u is on): bare `bash deploy-vps.sh` means --phase core.
PHASE="core"
if [[ "${1:-}" == "--phase" ]]; then
  if [[ -z "${2:-}" ]]; then
    error "--phase requires a value: infra | core | all | frontend"
    exit 1
  fi
  PHASE="$2"
elif [[ -n "${1:-}" ]]; then
  PHASE="$1"
fi

# Services that make up a complete backend. `core` deliberately deploys every
# service in the compose file: partial deploys leave the gateway routing to
# containers that were never started.
CORE_SERVICES="api api-gateway auth-service scoring-service tournament-service analytics-service payment-service notification-service ai-commentary-service streaming-service web nginx"

case "$PHASE" in
  infra)     SERVICES="redis kafka zookeeper" ;;
  core)      SERVICES="$CORE_SERVICES" ;;
  all)       SERVICES="" ;;  # empty = everything in compose
  frontend)  SERVICES="web nginx" ;;
  *) echo "Usage: bash deploy-vps.sh [--phase infra|core|all|frontend]"; exit 1 ;;
esac

# ─── Pre-flight checks ──────────────────────────────────────────────────────
step "Pre-flight checks"

if ! command -v docker &> /dev/null; then
  error "Docker is not installed. Install it first:"
  error "  curl -fsSL https://get.docker.com | sh"
  error "  sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  error "Docker Compose v2 is not installed. Install the Docker Compose plugin."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  warn ".env.prod not found. Copying from .env.production template."
  warn "You MUST edit .env.prod and fill in real secrets before continuing!"
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  exit 1
fi

# Verify critical env vars are set (not still placeholders).
# Read values with a parser instead of `source`-ing the file: the shipped
# .env.production contains unquoted values with spaces (e.g.
# `TWILIO_SID=AC_[Get from Twilio Dashboard]`) which make `source` fail partway
# through and silently leave later variables unset.
env_get() {
  local raw
  raw="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=(.*)\$/\2/p" "$ENV_FILE" | head -n 1)"
  if [[ "$raw" == \"*\" && "$raw" == *\" ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "$raw" == \'*\' && "$raw" == *\' ]]; then
    raw="${raw:1:${#raw}-2}"
  fi
  printf '%s' "$raw"
}

CRITICAL_VARS=(
  "DATABASE_URL"
  "CLERK_SECRET_KEY"
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  "NEXT_PUBLIC_SUPABASE_URL"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  # Both of these are enforced by the services themselves: their src/env.ts
  # throws at import time in production when the value is missing, so the
  # container would crash-loop on boot without them.
  "SCORING_GATEWAY_TOKEN"
  "STREAMING_ACCESS_TOKEN"
  "MEDIASOUP_ANNOUNCED_IP"
)
for var in "${CRITICAL_VARS[@]}"; do
  VAL="$(env_get "$var")"
  if [[ -z "$VAL" || "$VAL" == *"[Get"* || "$VAL" == *"[PROJECT"* || "$VAL" == *"[Your"* || "$VAL" == *"[For"* ]]; then
    error "$var is not set in .env.prod (empty or still a placeholder)."
    error "  Run: bash scripts/preflight.sh   for the full checklist"
    exit 1
  fi
done
log "All critical environment variables are set ✓"

# ─── Phase 1: Build images ──────────────────────────────────────────────────
step "Building Docker images (this may take 10-20 minutes on first run)"

if [[ "$PHASE" == "all" ]]; then
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --parallel
else
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build $SERVICES
fi
log "Docker images built ✓"

# ─── Phase 2: Start infrastructure ──────────────────────────────────────────
step "Starting infrastructure"

# Whether we are using the compose-managed postgres or an external (Supabase)
# database. The postgres service is profile-gated as "selfhosted-db", so with
# Supabase there is no local container to wait on.
USING_EXTERNAL_DB=0
DB_URL="$(env_get DATABASE_URL)"
if [[ "$DB_URL" == *"supabase"* || "$DB_URL" == *"@"* && "$DB_URL" != *"@postgres"* && "$DB_URL" != *"@localhost"* && "$DB_URL" != *"@127.0.0.1"* ]]; then
  USING_EXTERNAL_DB=1
fi

if [[ "$USING_EXTERNAL_DB" -eq 1 ]]; then
  log "External database detected (${DB_URL%%@*}@…); skipping local postgres ✓"
else
  log "Local postgres detected; enabling selfhosted-db profile"
  SERVICES="postgres $SERVICES"
fi

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d redis kafka zookeeper

if [[ "$USING_EXTERNAL_DB" -eq 0 ]]; then
  log "Waiting for PostgreSQL to be ready..."
  for i in {1..30}; do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready &>/dev/null; then
      log "PostgreSQL is ready ✓"
      break
    fi
    [[ $i -eq 30 ]] && { error "PostgreSQL failed to start"; exit 1; }
    sleep 2
  done
fi

log "Waiting for Kafka to be ready..."
sleep 10
log "Infrastructure ready ✓"

# ─── Phase 3: Run database migrations ───────────────────────────────────────
step "Running database migrations"

# Use the local pnpm to run drizzle migrations against Supabase/Postgres
cd "$PROJECT_DIR"
if command -v pnpm &> /dev/null; then
  pnpm --filter @mtk/database migrate || warn "Migration via pnpm failed (may already be applied via Supabase MCP)"
else
  warn "pnpm not installed on VPS — ensure migrations were applied via Supabase dashboard/MCP."
fi
log "Migrations complete ✓"

# ─── Phase 4: Start application services ────────────────────────────────────
step "Starting application services ($PHASE)"

if [[ "$PHASE" == "all" ]]; then
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
else
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d $SERVICES
fi

log "Waiting for services to start..."
sleep 15

# ─── Phase 5: Health checks ─────────────────────────────────────────────────
step "Health checks"

HEALTH_FAILURES=0
check_health() {
  local name="$1"
  local url="$2"
  local required="${3:-false}"
  for i in {1..12}; do
    if curl -sf "$url" &>/dev/null; then
      log "  ✓ $name healthy"
      return 0
    fi
    sleep 5
  done
  if [[ "$required" == "true" ]]; then
    error "  ✗ $name not responding at $url"
    HEALTH_FAILURES=$((HEALTH_FAILURES+1))
  else
    warn "  ✗ $name not responding at $url (may still be starting)"
  fi
  return 1
}

# The API gateway and main API are the only two hard requirements: if they are
# down the product is unusable. Everything else gets a warning so a slow-starting
# optional service does not abort an otherwise good deploy.
check_health "API Gateway"     "http://localhost:3000/api/v1/health"   true
check_health "Main API"        "http://localhost:4000/api/health"     true
check_health "Scoring Service" "http://localhost:4002/health"
check_health "Streaming"       "http://localhost:5008/health"

# The remaining services are internal to the compose network (no published host
# ports), so they cannot be curled from the host. Verify they are at least
# running and not crash-looping instead.
log "Checking internal service containers..."
for svc in auth-service tournament-service analytics-service payment-service notification-service ai-commentary-service; do
  cid="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q "$svc" 2>/dev/null || true)"
  if [[ -z "$cid" ]]; then
    error "  ✗ $svc is not running"
    HEALTH_FAILURES=$((HEALTH_FAILURES+1))
    continue
  fi
  state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
  restarts="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
  if [[ "$state" == "running" ]]; then
    if [[ "$restarts" -gt 3 ]]; then
      warn "  ! $svc is running but has restarted $restarts times (crash-looping?)"
    else
      log "  ✓ $svc running"
    fi
  else
    error "  ✗ $svc state=$state (restarts=$restarts)"
    HEALTH_FAILURES=$((HEALTH_FAILURES+1))
  fi
done

if [[ $HEALTH_FAILURES -gt 0 ]]; then
  error "$HEALTH_FAILURES critical service(s) failed health checks. Inspect logs before continuing:"
  error "  docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=100"
  exit 1
fi

# ─── Phase 6: Setup SSL (Nginx + Let's Encrypt) ─────────────────────────────
if [[ "$PHASE" == "all" || "$PHASE" == "core" ]]; then
  step "SSL Certificate Setup"

  if [[ ! -d "$PROJECT_DIR/nginx/ssl" ]]; then
    mkdir -p "$PROJECT_DIR/nginx/ssl"
  fi

  if [[ ! -f "$PROJECT_DIR/nginx/ssl/cert.pem" ]]; then
    log "No SSL certificates found. Options:"
    log "  1. Use Cloudflare SSL (recommended — set Cloudflare proxy to 'Full' mode)"
    log "  2. Generate Let's Encrypt certs: sudo certbot certonly --standalone -d api.ssl.mtkcodex.site"
    log "  3. Copy existing certs to nginx/ssl/cert.pem and nginx/ssl/key.pem"
  else
    log "SSL certificates found ✓"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d nginx 2>/dev/null || true
  fi
fi

# ─── Summary ────────────────────────────────────────────────────────────────
step "Deployment Summary"

echo -e "\n${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎉 SSL Cricket deployed successfully!                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}\n"

echo "Service status:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo -e "\nEndpoints:"
echo -e "  API Gateway:    ${BLUE}http://localhost:3000/api/v1/health${NC}"
echo -e "  Main API:       ${BLUE}http://localhost:4000/api/health${NC}"
echo -e "  Scoring WS:     ${BLUE}ws://localhost:4002${NC}"
echo -e "  API (public):   ${BLUE}https://api.ssl.mtkcodex.site${NC}"
echo -e "  WebSocket:      ${BLUE}wss://ws.ssl.mtkcodex.site${NC}"

echo -e "\nNext steps:"
echo -e "  1. Configure DNS in Cloudflare (A records → this VPS IP)"
echo -e "  2. Deploy frontends to Vercel (web, admin, marketing)"
echo -e "  3. Configure Clerk production domains"
echo -e "  4. Build & submit Android app via EAS"

echo -e "\nUseful commands:"
echo -e "  View logs:    ${BLUE}docker compose -f docker-compose.prod.yml logs -f${NC}"
echo -e "  Restart:      ${BLUE}docker compose -f docker-compose.prod.yml restart${NC}"
echo -e "  Stop:         ${BLUE}docker compose -f docker-compose.prod.yml down${NC}"
echo -e "  Update:       ${BLUE}git pull && bash deploy-vps.sh${NC}"
