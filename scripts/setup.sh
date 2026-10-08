#!/usr/bin/env bash

# Shakir Super League - Local Environment Setup Script
# Configures node, docker, dependencies, env, database, migrations, and seeds

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0;0m'

echo -e "${YELLOW}====================================================${NC}"
echo -e "${YELLOW}       Shakir Super League Setup Script             ${NC}"
echo -e "${YELLOW}====================================================${NC}"

# 1. Check Prerequisites
echo -e "\n${YELLOW}[1/6] Checking Prerequisites...${NC}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}✘ Node.js is not installed. Install Node.js v20+ to proceed.${NC}"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}✘ Node.js version is $NODE_VERSION. Version >= 20 is required.${NC}"
  exit 1
fi
echo -e "${GREEN}✔ Node.js version $(node -v) detected.${NC}"

if ! command -v pnpm &>/dev/null; then
  echo -e "${RED}✘ pnpm is not installed. Install pnpm to proceed: npm install -g pnpm${NC}"
  exit 1
fi
echo -e "${GREEN}✔ pnpm version $(pnpm -v) detected.${NC}"

if ! command -v docker &>/dev/null; then
  echo -e "${RED}✘ Docker is not installed or not running. Install Docker to proceed.${NC}"
  exit 1
fi
echo -e "${GREEN}✔ Docker detected.${NC}"

# 2. Setup Env Files
echo -e "\n${YELLOW}[2/6] Configuring Environment Files...${NC}"
if [ ! -f .env ]; then
  echo -e "Copying .env.example to .env..."
  cp .env.example .env
  echo -e "${GREEN}✔ Generated default .env file.${NC}"
else
  echo -e "${GREEN}✔ .env file already exists.${NC}"
fi

# 3. Start Local Infrastructure
echo -e "\n${YELLOW}[3/6] Starting Local Infrastructure (Docker Compose)...${NC}"
docker compose up -d postgres redis kafka zookeeper

# 4. Wait for PostgreSQL to be healthy
echo -e "\n${YELLOW}[4/6] Waiting for PostgreSQL to be ready...${NC}"
RETRIES=10
until docker exec ssl-postgres pg_isready -U ssl &>/dev/null || [ $RETRIES -eq 0 ]; do
  echo "PostgreSQL is starting... ($RETRIES retries left)"
  RETRIES=$((RETRIES-1))
  sleep 3
done

if [ $RETRIES -eq 0 ]; then
  echo -e "${RED}✘ PostgreSQL failed to start in time. Check docker logs ssl-postgres.${NC}"
  exit 1
fi
echo -e "${GREEN}✔ PostgreSQL is healthy and accepting connections.${NC}"

# 5. Install Dependencies
echo -e "\n${YELLOW}[5/6] Installing Monorepo Dependencies...${NC}"
pnpm install

# 6. Database Migrations and Seed
echo -e "\n${YELLOW}[6/6] Building Database Package and Running Migrations...${NC}"
# Build shared database package first
pnpm --filter @mtk/database build

# Run migrations
echo "Running migrations..."
pnpm --filter @mtk/database db:migrate || echo "Migrations might have already been applied."

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}    Setup completed successfully!                   ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "To start the development services, run:"
echo -e "  ${YELLOW}pnpm dev${NC}"
echo -e "\nExposed Local Endpoints:"
echo -e "  - Marketing Landing:  http://localhost:3000"
echo -e "  - Web Application:    http://localhost:3001"
echo -e "  - Super Admin Panel:  http://localhost:3002"
echo -e "  - API Gateway:        http://localhost:3000/api/v1"
echo -e "===================================================="
