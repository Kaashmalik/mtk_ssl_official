#!/usr/bin/env bash
# ============================================================================
# SSL Cricket — pre-deployment validator
#
# Read-only. Checks everything that would otherwise fail late (mid-deploy, with
# containers restarting). Safe to run any number of times.
#
#   bash scripts/preflight.sh
#
# Exit codes:  0 = ready   1 = blockers found
# ============================================================================

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.prod}"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
BLOCKERS=0; WARNINGS=0

section() { echo -e "\n${BLUE}── $* ──${NC}"; }
ok()      { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}!${NC} $*"; WARNINGS=$((WARNINGS+1)); }
fail()    { echo -e "  ${RED}✗${NC} $*"; BLOCKERS=$((BLOCKERS+1)); }

# ─── 1. Tooling ─────────────────────────────────────────────────────────────
section "Tooling"
if command -v docker >/dev/null 2>&1; then
  ok "docker installed ($(docker --version 2>/dev/null | head -1))"
else
  fail "docker not installed"
fi

if docker compose version >/dev/null 2>&1; then
  ok "docker compose v2 available"
else
  fail "docker compose v2 plugin missing"
fi

if docker info >/dev/null 2>&1; then
  ok "docker daemon reachable"
else
  fail "docker daemon not running (start Docker / dockerd)"
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm installed ($(pnpm --version))"
else
  warn "pnpm not installed — run migrations from your dev machine instead"
fi

# ─── 2. Environment file ────────────────────────────────────────────────────
section "Environment file"

# Read a KEY=value out of the env file WITHOUT sourcing it. Sourcing is unsafe
# and breaks outright on unquoted values containing spaces, e.g.
#   TWILIO_SID=AC_[Get from Twilio Dashboard]
# which is exactly what .env.production ships with.
env_get() {
  local raw
  raw="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=(.*)\$/\2/p" "$ENV_FILE" | head -n 1)"
  # Strip one layer of matching surrounding quotes, plus surrounding whitespace.
  if [[ "$raw" == \"*\" && "$raw" == *\" ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "$raw" == \'*\' && "$raw" == *\' ]]; then
    raw="${raw:1:${#raw}-2}"
  fi
  printf '%s' "$raw"
}

if [[ ! -f "$ENV_FILE" ]]; then
  fail "$ENV_FILE not found"
  echo "    Create it:  cp $PROJECT_DIR/.env.production $ENV_FILE"
  echo "    Then fill in every value marked required."
else
  ok "$ENV_FILE exists"
fi

# ─── 3. Required secrets ────────────────────────────────────────────────────
section "Required secrets"
# These are the values whose absence makes a service refuse to boot in
# production (see each service's src/env.ts) or breaks the frontend.
check_secret() {
  local name="$1"; local hint="${2:-}"
  local val; val="$(env_get "$name")"
  if [[ -z "$val" ]]; then
    fail "$name is not set${hint:+ — $hint}"
  elif [[ "$val" == *"[Get"* || "$val" == *"[PROJECT"* || "$val" == *"[Your"* || "$val" == *"[For"* || "$val" == *"your"* || "$val" == *"changeme"* ]]; then
    fail "$name still looks like a placeholder${hint:+ — $hint}"
  else
    ok "$name set"
  fi
}

check_secret DATABASE_URL "services will not reach the database"
check_secret CLERK_SECRET_KEY "auth fails"
check_secret NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "frontend auth UI breaks"
check_secret NEXT_PUBLIC_SUPABASE_URL "frontend data layer breaks"
check_secret STRIPE_SECRET_KEY "payments fail"
check_secret STRIPE_WEBHOOK_SECRET "payment confirmations fail"
check_secret SCORING_GATEWAY_TOKEN "scoring-service refuses to boot in production"
check_secret STREAMING_ACCESS_TOKEN "streaming-service refuses to boot in production"
check_secret MEDIASOUP_ANNOUNCED_IP "WebRTC clients cannot reach media ports"

# ─── 4. Database target ─────────────────────────────────────────────────────
section "Database target"
DB_URL="$(env_get DATABASE_URL)"
if [[ -z "$DB_URL" ]]; then
  fail "DATABASE_URL missing — cannot validate"
elif [[ "$DB_URL" == *"[PROJECT"* || "$DB_URL" == *"[Your"* || "$DB_URL" == *"[Get"* || "$DB_URL" == *"[HOST"* || "$DB_URL" == *"[PASSWORD"* ]]; then
  fail "DATABASE_URL is still a template placeholder — paste the real Supabase connection string"
elif [[ "$DB_URL" == *"supabase"* ]]; then
  ok "DATABASE_URL points at Supabase (managed) — local postgres stays disabled"
elif [[ "$DB_URL" == *"@postgres"* || "$DB_URL" == *"localhost"* || "$DB_URL" == *"127.0.0.1"* ]]; then
  warn "DATABASE_URL points at a local/container database — self-hosting path"
else
  warn "DATABASE_URL host not recognised: $(printf '%s' "$DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')"
fi

# ─── 5. Placeholder leftovers ───────────────────────────────────────────────
section "Placeholder scan"
if [[ -f "$ENV_FILE" ]]; then
  leftovers="$(grep -nE '\[[A-Z_]+\]|your-|changeme|REPLACE_ME' "$ENV_FILE" \
    | grep -vE '^\s*#' | grep -vE '(REGION|Get from|Get your|PROJECT)' || true)"
  if [[ -n "$leftovers" ]]; then
    warn "possible placeholders left in $ENV_FILE:"
    echo "$leftovers" | sed 's/^/      /'
  else
    ok "no obvious placeholders remain"
  fi
fi

# ─── 6. TLS ─────────────────────────────────────────────────────────────────
section "TLS"
if [[ -f "$PROJECT_DIR/nginx/ssl/cert.pem" && -f "$PROJECT_DIR/nginx/ssl/key.pem" ]]; then
  ok "TLS certificate and key present"
else
  warn "no TLS cert/key in nginx/ssl — HTTPS will not start"
  echo "      Options: Cloudflare Full proxy, or"
  echo "      sudo certbot certonly --standalone -d ssl.mtkcodex.site -d api.ssl.mtkcodex.site -d ws.ssl.mtkcodex.site"
fi

# ─── 7. Compose file ────────────────────────────────────────────────────────
section "Compose file"
if [[ -f "$COMPOSE_FILE" ]]; then
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet >/dev/null 2>&1; then
    ok "docker-compose.prod.yml is valid"
  else
    fail "docker-compose.prod.yml failed validation"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet 2>&1 | sed 's/^/      /'
  fi

  if grep -q 'profiles: \["selfhosted-db"\]' "$COMPOSE_FILE"; then
    ok "postgres is profile-gated (won't start alongside Supabase)"
  else
    warn "postgres is NOT profile-gated — it will start even with Supabase"
  fi
else
  fail "$COMPOSE_FILE not found"
fi

# ─── 8. Port availability ───────────────────────────────────────────────────
section "Port availability"
for port in 3000 3001 3002 4000 4002 5001 5002 5004 5005 5006 5007 5008; do
  if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    warn "port $port already in use"
  fi
done
ok "port scan complete (warnings above are informational)"

# ─── Verdict ────────────────────────────────────────────────────────────────
echo ""
if [[ $BLOCKERS -gt 0 ]]; then
  echo -e "${RED}✗ NOT READY — $BLOCKERS blocker(s), $WARNINGS warning(s)${NC}"
  echo "  Fix the blockers above, then re-run: bash scripts/preflight.sh"
  exit 1
fi

echo -e "${GREEN}✓ READY — 0 blockers, $WARNINGS warning(s)${NC}"
echo ""
echo "  Next:  bash deploy-vps.sh --phase core"
exit 0
