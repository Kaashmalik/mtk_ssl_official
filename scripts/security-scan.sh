#!/usr/bin/env bash

# Shakir Super League Local Security & Vulnerability Scanner
# Runs SAST (Dependency audits, Secret scans) & DAST placeholders

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0;0m'

echo -e "${YELLOW}=== Starting Shakir Super League Security Scan ===${NC}"

# 1. Dependency Audit (SAST)
echo -e "\n${YELLOW}[1/3] Running Dependency Audit...${NC}"
if pnpm audit; then
  echo -e "${GREEN}✔ Dependency audit passed successfully!${NC}"
else
  echo -e "${RED}✘ Dependency audit found vulnerabilities. Review the log above.${NC}"
fi

# 2. Secret Scanning (Detect Secrets/API Keys in codebase)
echo -e "\n${YELLOW}[2/3] Checking for exposed secrets/keys...${NC}"
# Use standard regex to search for common secret patterns (ignoring example env files)
SECRET_PATTERNS=("CLERK_SECRET_KEY=[a-zA-Z0-9_]{10,}" "DATABASE_URL=postgres://" "STRIPE_SECRET_KEY=sk_")
LEAK_FOUND=false

for PATTERN in "${SECRET_PATTERNS[@]}"; do
  # Search, ignoring docs, git, and example envs
  if grep -rwn --exclude-dir={.git,node_modules,dist,docs} --exclude="*.example" --exclude="*.md" -E "$PATTERN" . 2>/dev/null; then
    echo -e "${RED}⚠ Found potential leaked secret matching pattern: $PATTERN${NC}"
    LEAK_FOUND=true
  fi
done

if [ "$LEAK_FOUND" = false ]; then
  echo -e "${GREEN}✔ No exposed secrets detected in source files.${NC}"
else
  echo -e "${RED}✘ Potential secrets detected. Please remove them before committing!${NC}"
fi

# 3. DAST (OWASP ZAP / Dynamic scan placeholder)
echo -e "\n${YELLOW}[3/3] Dynamic Application Security Testing (DAST)...${NC}"
echo -e "DAST Target: http://localhost:3000 (API Gateway)"
echo -e "To run a full OWASP ZAP container scan, execute:"
echo -e "  docker run -t ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py -t http://localhost:3000/api/v1/health -f openapi"

echo -e "\n${GREEN}=== Security Scan Finished ===${NC}"
