# 🚀 SSL Cricket — Go-Live Checklist

Complete step-by-step guide to take your project live. Follow these in order.

---

## ✅ Pre-Completed (Already Done)

- [x] **10 service Dockerfiles** created (Node 22 Alpine, multi-stage, non-root user)
- [x] **`.dockerignore`** created (excludes node_modules, .next, .git, etc.)
- [x] **`docker-compose.prod.yml`** updated (all build contexts point to monorepo root)
- [x] **`nginx/nginx.conf`** updated (ssl.cricket, api.ssl.cricket, ws.ssl.cricket domains)
- [x] **`.env.production`** template updated (real domains, ACME/SSL automation, VPS Redis/Kafka)
- [x] **`apps/mobile/app.config.js`** updated (production API URL → `https://api.ssl.cricket`)
- [x] **`deploy-vps.sh`** deployment script created (phased: infra → core → all)
- [x] **Database** fully migrated (51 tables + 1 materialized view on Supabase)

---

## Phase 1: Get Your Keys (Day 1 — 1-2 hours)

### 1.1 Clerk (Authentication) — Upgrade to Production
1. Go to https://dashboard.clerk.com
2. Create a **Production** instance (or toggle existing to live mode)
3. Copy:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_live_`)
   - `CLERK_SECRET_KEY` (starts with `sk_live_`)
4. Add allowed origins:
   - `https://ssl.cricket`
   - `https://admin.ssl.cricket`

### 1.2 Supabase (Database) — Already Connected ✓
Your Supabase project is live. Copy from Dashboard → Settings → API:
- `DATABASE_URL` (connection pooler, port 6543 or 5432)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 1.3 Cloudflare (DNS + SSL) — Free
1. Go to https://dash.cloudflare.com
2. Add your domain `ssl.cricket` to Cloudflare
3. Update nameservers at your domain registrar
4. Generate an **API Token** (My Profile → API Tokens → Edit zone DNS)
5. Copy: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`

### 1.4 Sentry (Error Tracking) — Free Tier
1. Go to https://sentry.io → Create project
2. Copy: `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`

---

## Phase 2: Set Up Oracle Cloud VPS (Day 1 — 30 min)

### 2.1 Create Free ARM Instance
1. Go to https://cloud.oracle.com → Compute → Create Instance
2. Shape: **VM.Standard.A1.Flex** (4 OCPUs, 24GB RAM — **always free**)
3. Image: **Canonical Ubuntu 22.04**
4. Save SSH key pair
5. Add cloud security rules for ports: 22, 80, 443, 3000, 4000, 4002, 5001, 5002

### 2.2 Initial Server Setup
```bash
ssh ubuntu@<YOUR_VPS_IP>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install pnpm + Node (for migrations)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm@9.15.0

# Configure firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 2.3 Clone & Configure Project
```bash
git clone https://github.com/Kaashmalik/mtk-ssl2026.git
cd mtk-ssl

# Create production env file from template
cp .env.production .env.prod

# Edit .env.prod — fill in ALL real values
nano .env.prod
```

**Critical variables to fill in `.env.prod`:**
```
POSTGRES_PASSWORD=<generate-strong-password>
DATABASE_URL=<your-supabase-connection-string>
CLERK_SECRET_KEY=sk_live_xxx
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx
CRON_SECRET=<generate-32-char-random-string>
SSL_ADMIN_TOKEN=<generate-32-char-random-string>
IMPERSONATION_TOKEN_SECRET=<generate-32-char-random-string>
CLOUDFLARE_API_TOKEN=xxx
CLOUDFLARE_ZONE_ID=xxx
SENTRY_DSN=https://xxx@sentry.io/xxx
```

---

## Phase 3: Deploy Backend on VPS (Day 2 — 30 min)

### 3.1 Run Deployment Script (Core Services)
```bash
cd ~/mtk-ssl
bash deploy-vps.sh --phase core
```

This will:
1. Build Docker images for: api, api-gateway, auth-service, scoring-service, tournament-service
2. Start infrastructure: PostgreSQL, Redis, Kafka, Zookeeper
3. Run database migrations
4. Start all core services
5. Run health checks

### 3.2 Verify Services Are Running
```bash
# Check all containers
docker compose -f docker-compose.prod.yml ps

# Test health endpoints
curl http://localhost:4000/api/health
curl http://localhost:3000/api/v1/health
curl http://localhost:4002/health

# View logs if something fails
docker compose -f docker-compose.prod.yml logs -f api
```

### 3.3 Add Secondary Services Later (when keys ready)
```bash
# Payment service (when Stripe/JazzCash keys ready)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d payment-service

# Notification service (when Firebase/SMTP ready)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d notification-service

# Everything at once
bash deploy-vps.sh --phase all
```

---

## Phase 4: Configure DNS in Cloudflare (Day 2 — 10 min)

### 4.1 Add DNS Records

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| **A** | `ssl.cricket` | `<VPS_PUBLIC_IP>` | 🟠 Proxied |
| **A** | `api.ssl.cricket` | `<VPS_PUBLIC_IP>` | 🟠 Proxied |
| **A** | `ws.ssl.cricket` | `<VPS_PUBLIC_IP>` | 🟠 Proxied |
| **A** | `admin.ssl.cricket` | `<VPS_PUBLIC_IP>` | ⚪ DNS only (Vercel CNAME) |
| **CNAME** | `admin.ssl.cricket` | `cname.vercel-dns.com` | 🟠 Proxied |

> **Note:** Replace the `admin` A record with a CNAME to Vercel once you connect Vercel.

### 4.2 SSL/TLS Settings in Cloudflare
1. Go to SSL/TLS → Overview
2. Set encryption mode to **Full** (not Flexible)
3. Enable **Always Use HTTPS**
4. Edge Certificates → Enable **Automatic HTTPS Rewrites**

---

## Phase 5: Deploy Frontend to Vercel (Day 2 — 20 min)

### 5.1 Deploy Web App (ssl.cricket)
1. Go to https://vercel.com → New Project
2. Import your GitHub repo `mtk-ssl`
3. **Root Directory:** `apps/web`
4. **Build Command:** `cd ../.. && pnpm turbo build --filter=@mtk/web`
5. **Install Command:** `cd ../.. && pnpm install`
6. Add Environment Variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://api.ssl.cricket` |
| `NEXT_PUBLIC_WS_URL` | `wss://ws.ssl.cricket` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_xxx` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJxxx` |
| `SENTRY_DSN` | `https://xxx@sentry.io/xxx` |

7. Deploy → Add custom domain `ssl.cricket`

### 5.2 Deploy Admin App (admin.ssl.cricket)
1. Repeat with Root Directory: `apps/admin`
2. Build Command: `cd ../.. && pnpm turbo build --filter=@mtk/admin`
3. Add domain `admin.ssl.cricket`

### 5.3 Deploy Marketing App
1. Repeat with Root Directory: `apps/marketing`
2. Build Command: `cd ../.. && pnpm turbo build --filter=@mtk/marketing`

---

## Phase 6: Build & Submit Android App (Day 3-5)

### 6.1 Set Up EAS Secrets
```bash
cd apps/mobile

# Set production environment secrets
eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value "https://api.ssl.cricket"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://xxx.supabase.co"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJxxx"
```

### 6.2 Build Production APK
```bash
eas build --platform android --profile production
```

### 6.3 Submit to Google Play
1. Create Google Play Developer account ($25 one-time): https://play.google.com/console
2. Create service account JSON key
3. Save as `apps/mobile/google-service-account.json`
4. Submit:
```bash
eas submit --platform android --profile production
```

---

## Phase 7: Post-Deployment Verification

### Final Health Checks
```bash
# API health
curl https://api.ssl.cricket/api/health

# WebSocket connection test (use browser console)
new WebSocket('wss://ws.ssl.cricket')

# Frontend
open https://ssl.cricket
open https://admin.ssl.cricket
```

### Monitoring Checklist
- [ ] Sentry dashboard showing events (trigger a test error)
- [ ] Docker containers all `Up` with no restart loops
- [ ] Vercel deployments successful for all 3 apps
- [ ] Clerk login working on production domains
- [ ] Database migrations confirmed on Supabase

---

## Quick Reference Commands

```bash
# === VPS Backend ===
bash deploy-vps.sh --phase core     # Deploy core services
bash deploy-vps.sh --phase all      # Deploy everything
docker compose -f docker-compose.prod.yml logs -f   # Watch logs
docker compose -f docker-compose.prod.yml restart   # Restart all
docker compose -f docker-compose.prod.yml down      # Stop all

# === Update Deployment ===
cd ~/mtk-ssl
git pull
bash deploy-vps.sh --phase core

# === Database Migration (on VPS) ===
pnpm --filter @mtk/database migrate

# === Mobile App ===
cd apps/mobile
eas build --platform android --profile production
eas submit --platform android
```

---

## Cost Summary

| Resource | Provider | Monthly Cost |
|----------|----------|-------------|
| Frontend (3 apps) | Vercel Hobby | **$0** |
| Database | Supabase Free | **$0** |
| Backend VPS | Oracle Cloud Free | **$0** |
| DNS + SSL + CDN | Cloudflare Free | **$0** |
| Error Tracking | Sentry Developer | **$0** |
| **Total** | | **$0/month** |

One-time costs:
- Google Play Developer account: **$25**
- Domain ssl.cricket: **~$10-30/year**
