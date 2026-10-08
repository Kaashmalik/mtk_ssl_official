# 🚀 SSL Cricket — Production Go-Live Master Plan

> **The definitive, single-source-of-truth deployment guide.**
> Supersedes: `DEPLOY.md`, `DEPLOYMENT.md`, `GO-LIVE-CHECKLIST.md`

**Project:** Shakir Super League (SSL) — Cricket Management SaaS  
**Version:** 2.0.0  
**Intended domain:** `ssl.mtkcodex.site` (primary) — **not publicly deployed yet** (DNS unresolved as of 2026-09-23)  
**Repository:** https://github.com/Kaashmalik/mtk-ssl2026.git  
**Author:** Muhammad Kashif / Malik Tech  
**Last Updated:** 2026-09-23 (deploy status reconciled with doc-truth audit)

---

## 📋 Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Hosting Topology](#2-hosting-topology)
3. [Phase 1 — Prerequisites & Accounts](#3-phase-1--prerequisites--accounts)
4. [Phase 2 — Database (Supabase)](#4-phase-2--database-supabase)
5. [Phase 3 — Backend VPS (Oracle Cloud)](#5-phase-3--backend-vps-oracle-cloud)
6. [Phase 4 — DNS & SSL (Cloudflare)](#6-phase-4--dns--ssl-cloudflare)
7. [Phase 5 — Frontend Deployment (Vercel)](#7-phase-5--frontend-deployment-vercel)
8. [Phase 6 — Mobile App (EAS / Play Store)](#8-phase-6--mobile-app-eas--play-store)
9. [Phase 7 — CI/CD Pipeline](#9-phase-7--cicd-pipeline)
10. [Phase 8 — Monitoring & Observability](#10-phase-8--monitoring--observability)
11. [Phase 9 — Security Hardening](#11-phase-9--security-hardening)
12. [Phase 10 — Post-Launch Operations](#12-phase-10--post-launch-operations)
13. [Cost Summary](#13-cost-summary)
14. [Quick Reference Commands](#14-quick-reference-commands)
15. [Troubleshooting Playbook](#15-troubleshooting-playbook)
16. [Go-Live Day Checklist](#16-go-live-day-checklist)
17. [🎓 GitHub Student Pack Benefits](#17--github-student-pack-benefits)

---

## 🎓 GitHub Student Developer Pack — Your Secret Weapon

> **You have the GitHub Student Developer Pack!** This unlocks **$10,000+ in premium tools for FREE**.
> Below is every relevant perk mapped to your SSL Cricket project.

### 🏆 High-Impact Perks (Use These First)

| Perk | Normal Price | Student Benefit | Use For |
|------|-------------|-----------------|--------|
| **DigitalOcean** | $5-48/mo | **$200 credit** (1 year) | 🔥 **Alternative/backup VPS** — spin up a $12/mo droplet for 16 months free. Better reliability than Oracle free tier |
| **Microsoft Azure** | $100+/mo | **$100 credit** + free services | Backup VPS or Azure Container Instances for overflow |
| **Vercel Pro** | $20/mo | **FREE** while student | ✅ Pro features: analytics, password protection, 10x bandwidth |
| **Namecheap** | $10-30/yr | **Free .me domain** + SSL cert for 1 year | Free `sslcricket.me` or `mtkcodex.me` as backup domain |
| **Name.com** | $10-30/yr | **Free domain** for 1 year | Another free domain option |
| **.tech domains** | $12/yr | **Free .tech domain** for 1 year | Get `sslcricket.tech` or `maliktech.tech` free |

### 📊 Monitoring & DevOps Perks

| Perk | Normal Price | Student Benefit | Use For |
|------|-------------|-----------------|--------|
| **Sentry** | $26/mo (Team) | **500K events/month** free | ✅ Already using — upgrade to full Team plan features |
| **DataDog** | $15/host/mo | **Pro plan free** for 2 years | 🔥 Replace Prometheus/Grafana with industry-standard APM |
| **New Relic** | $99/mo | **Free student access** | Alternative APM with full-stack observability |
| **LogDNA/Mezmo** | $30/mo | **Free student plan** | Centralized log aggregation (better than `docker logs`) |
| **PagerDuty** | $21/user/mo | **Free for students** | On-call alerting when services go down |
| **Better Stack** | $24/mo | **Free 1-year** | Uptime monitoring + incident management |

### 🔒 Security Perks

| Perk | Normal Price | Student Benefit | Use For |
|------|-------------|-----------------|--------|
| **Snyk** | $25/dev/mo | **Free for students** | Dependency vulnerability scanning (already in your CI) |
| **1Password** | $3/mo | **Free for 1 year** | Store production secrets securely |
| **Doppler** | $7/dev/mo | **Free for students** | Secrets management across all environments |

### 🛠️ Development Perks

| Perk | Normal Price | Student Benefit | Use For |
|------|-------------|-----------------|--------|
| **GitHub Pro** | $4/mo | **FREE** while student | Unlimited private repos, 3K CI/CD minutes/mo, advanced code review |
| **GitHub Copilot** | $10/mo | **FREE** while student | AI-powered coding assistant |
| **JetBrains IDEs** | $25/mo | **All IDEs free** | WebStorm for TypeScript, DataGrip for database |
| **Canva Pro** | $13/mo | **Free for students** | Design marketing assets, store listing graphics |
| **Figma** | $12/mo | **Free Education plan** | UI/UX design for the platform |
| **Icons8** | $13/mo | **Free for 3 months** | Icons, illustrations, photos for the app |
| **Polypane** | $12/mo | **Free for 1 year** | Cross-browser/device testing |
| **Educative** | $60/mo | **6 free months** | Learn advanced DevOps, K8s, system design |

### 🎯 Recommended Student Stack Upgrade

Here's how to upgrade your hosting stack using student perks at **$0 additional cost**:

```
BEFORE (Free-only stack):              AFTER (Student-upgraded stack):
─────────────────────────              ────────────────────────────────
Vercel Hobby (limited)          →      ✅ Vercel Pro ($20/mo saved)
Oracle Cloud Free (flaky)       →      ✅ DigitalOcean $12/mo droplet (paid by $200 credit)
Sentry Developer (10K events)   →      ✅ Sentry Team (500K events/mo)
No APM                          →      ✅ DataDog Pro (full APM, traces, logs)
Manual logging                  →      ✅ LogDNA centralized logs
No secrets management           →      ✅ 1Password or Doppler
No uptime monitoring            →      ✅ Better Stack / PagerDuty
Paying for domain               →      ✅ Free .me or .tech domain

💰 Total Value Unlocked: ~$300+/month in tools for FREE
```

### 📋 Activation Checklist

1. **Verify student status:** https://education.github.com/pack
2. Apply with your `.edu` email or upload enrollment proof
3. Once approved, activate each perk from the Pack page:

- [ ] **DigitalOcean** → Claim $200 credit → Create 4GB/2CPU Droplet ($12/mo)
- [ ] **Vercel Pro** → Link GitHub student account → Auto-upgrade to Pro
- [ ] **Namecheap** → Claim free `.me` domain
- [ ] **Sentry** → Upgrade to Team plan with student verification
- [ ] **DataDog** → Create account → Apply student plan
- [ ] **1Password** → Claim 1-year free subscription
- [ ] **JetBrains** → Get license for WebStorm + DataGrip
- [ ] **GitHub Copilot** → Enable in GitHub settings
- [ ] **Canva Pro** → Verify student email

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         USERS / CLIENTS                             │
│   Browser (Web/Admin)  │  Mobile App (Expo/RN)  │  Public API       │
└───────────┬────────────┴───────────┬─────────────┴──────┬────────────┘
            │                        │                     │
            ▼                        ▼                     ▼
┌───────────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│   Cloudflare CDN      │  │   Cloudflare     │  │   Cloudflare        │
│   ssl.mtkcodex.site   │  │   (Proxy + WAF)  │  │   api.ssl.mtkcodex  │
│   admin.ssl.mtkcodex  │  │                  │  │   ws.ssl.mtkcodex   │
└──────────┬────────────┘  └────────┬─────────┘  └──────────┬──────────┘
           │                        │                        │
           ▼                        │                        ▼
┌──────────────────────┐            │          ┌──────────────────────────┐
│   VERCEL (Edge)      │            │          │   ORACLE CLOUD VPS       │
│   ┌────────────────┐ │            │          │   (ARM64, 4 OCPU, 24GB) │
│   │ apps/web       │ │            │          │                          │
│   │ (Next.js SSR)  │ │            │          │  ┌─── Docker Compose ──┐ │
│   ├────────────────┤ │            │          │  │                     │ │
│   │ apps/admin     │ │            │          │  │  Nginx (80/443)     │ │
│   │ (Next.js SSR)  │ │            │          │  │    ↓                │ │
│   ├────────────────┤ │            │          │  │  API Gateway (3000) │ │
│   │ apps/marketing │ │            │          │  │  Main API    (4000) │ │
│   │ (Next.js SSG)  │ │            │          │  │  Auth Svc    (5001) │ │
│   └────────────────┘ │            │          │  │  Scoring WS  (4002) │ │
└──────────────────────┘            │          │  │  Tournament  (5002) │ │
                                    │          │  │  Payment     (5004) │ │
                                    │          │  │  Notification(5005) │ │
                                    │          │  │  AI Comment. (5006) │ │
                                    │          │  │  Analytics   (5007) │ │
                                    │          │  │  Streaming   (5008) │ │
                                    │          │  │                     │ │
                                    │          │  │  Redis   (6379)     │ │
                                    │          │  │  Kafka   (29092)    │ │
                                    │          │  │  ClickHouse (8123)  │ │
                                    │          │  └─────────────────────┘ │
                                    │          └──────────────────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │   SUPABASE       │
                          │   PostgreSQL 17  │
                          │   (Managed)      │
                          │   51 tables      │
                          └──────────────────┘
```

### Component Breakdown

| Layer           | Component              | Hosted On          | Why                                           |
|-----------------|------------------------|--------------------|-----------------------------------------------|
| **Frontend**    | `apps/web`             | Vercel (Hobby/Pro) | Edge SSR, auto-scaling, zero config            |
| **Frontend**    | `apps/admin`           | Vercel (Hobby/Pro) | Same — separate deploy for RBAC isolation      |
| **Frontend**    | `apps/marketing`       | Vercel (Hobby/Pro) | ISR/SSG, global CDN                            |
| **Mobile**      | `apps/mobile`          | EAS + Play Store   | Native Android APK via Expo EAS Build          |
| **API**         | 10 microservices       | Oracle Cloud VPS   | Always-free ARM (24GB RAM), Docker Compose     |
| **Database**    | PostgreSQL 17          | Supabase           | Managed, backups, connection pooler            |
| **Cache**       | Redis 7                | VPS (Docker)       | Co-located with services, low latency          |
| **Queue**       | Kafka + Zookeeper      | VPS (Docker)       | Event streaming for scoring/notifications      |
| **Analytics**   | ClickHouse             | VPS (Docker)       | OLAP queries for match analytics               |
| **CDN / WAF**   | Cloudflare             | Cloudflare         | Free DDoS protection, SSL termination          |
| **DNS**         | Cloudflare             | Cloudflare         | Fast propagation, DNSSEC                       |
| **Monitoring**  | Sentry + Grafana       | SaaS + VPS         | Error tracking + metrics visualization         |
| **CI/CD**       | GitHub Actions         | GitHub             | Automated lint → test → security → build → deploy |

---

## 2. Hosting Topology

### Domain Architecture

```
ssl.mtkcodex.site           → Vercel (apps/web)
admin.ssl.mtkcodex.site     → Vercel (apps/admin)
marketing.ssl.mtkcodex.site → Vercel (apps/marketing) [or ssl.mtkcodex.site root]
api.ssl.mtkcodex.site       → VPS Nginx → API Gateway / Main API
ws.ssl.mtkcodex.site        → VPS Nginx → Scoring Service WebSocket
gateway.ssl.mtkcodex.site   → VPS Nginx → API Gateway (gRPC routing)
```

### Port Map (VPS Internal)

| Port         | Service              | Exposed Externally? |
|--------------|----------------------|---------------------|
| 80, 443      | Nginx                | ✅ Yes              |
| 3000         | API Gateway          | Via Nginx only       |
| 4000         | Main API             | Via Nginx only       |
| 4002         | Scoring WS           | Via Nginx only       |
| 5001         | Auth Service         | ❌ Internal only     |
| 5002         | Tournament Service   | ❌ Internal only     |
| 5004         | Payment Service      | ❌ Internal only     |
| 5005         | Notification Service | ❌ Internal only     |
| 5006         | AI Commentary        | ❌ Internal only     |
| 5007         | Analytics Service    | ❌ Internal only     |
| 5008         | Streaming Service    | ✅ Yes (UDP/WebRTC)  |
| 6379         | Redis                | ❌ Internal only     |
| 29092        | Kafka                | ❌ Internal only     |
| 8123         | ClickHouse           | ❌ Internal only     |

---

## 3. Phase 1 — Prerequisites & Accounts

**Time:** ~2 hours | **Cost:** $0 (with Student Pack)

### 3.1 Create Accounts (Student-Upgraded)

| Service            | URL                                  | Tier (Student)          | Purpose                |
|--------------------|--------------------------------------|-------------------------|------------------------|
| **GitHub**         | https://github.com                   | 🎓 **Pro** (free)       | Code + CI/CD + 3K mins/mo |
| **Vercel**         | https://vercel.com                   | 🎓 **Pro** (free)       | Frontend hosting (10x limits) |
| **DigitalOcean**   | https://digitalocean.com             | 🎓 **$200 credit**      | Backend VPS (16 months free) |
| **Oracle Cloud**   | https://cloud.oracle.com             | Always Free (backup)    | Backup VPS if needed   |
| **Supabase**       | https://supabase.com                 | Free                    | PostgreSQL database    |
| **Cloudflare**     | https://dash.cloudflare.com          | Free                    | DNS + CDN + SSL        |
| **Clerk**          | https://dashboard.clerk.com          | Free                    | Authentication         |
| **Sentry**         | https://sentry.io                    | 🎓 **Team** (500K events) | Error tracking       |
| **DataDog**        | https://datadoghq.com                | 🎓 **Pro** (free 2yr)   | APM + metrics + logs   |
| **Namecheap**      | https://namecheap.com                | 🎓 **Free .me domain**  | Backup/alt domain      |
| **1Password**      | https://1password.com                | 🎓 **Free 1 year**      | Secrets management     |
| **Expo EAS**       | https://expo.dev                     | Free                    | Mobile builds          |
| **Google Play**    | https://play.google.com/console      | $25 one-time            | App distribution       |

### 3.2 Obtain Production API Keys

Collect these keys and store them securely (e.g., in a password manager):

```
✅ Clerk
   - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  (pk_live_...)
   - CLERK_SECRET_KEY                   (sk_live_...)

✅ Supabase
   - DATABASE_URL                       (postgresql://postgres.xxx:pass@pooler:5432/postgres)
   - NEXT_PUBLIC_SUPABASE_URL           (https://xxx.supabase.co)
   - NEXT_PUBLIC_SUPABASE_ANON_KEY      (eyJ...)
   - SUPABASE_SERVICE_ROLE_KEY          (eyJ...)

✅ Cloudflare
   - CLOUDFLARE_API_TOKEN               (Edit DNS token)
   - CLOUDFLARE_ZONE_ID                 (from domain overview)

✅ Sentry
   - SENTRY_DSN                         (https://xxx@sentry.io/xxx)
   - SENTRY_AUTH_TOKEN                   (for source map uploads)

✅ Stripe (when ready)
   - STRIPE_SECRET_KEY                  (sk_live_...)
   - STRIPE_WEBHOOK_SECRET             (whsec_...)

✅ Firebase (when ready)
   - FIREBASE_SERVICE_ACCOUNT           (JSON service account)

✅ OpenAI (when ready)
   - OPENAI_API_KEY                     (sk-...)
```

### 3.3 Generate Secrets

```bash
# Generate 3 random secrets for production use
openssl rand -base64 32  # → CRON_SECRET
openssl rand -base64 32  # → SSL_ADMIN_TOKEN
openssl rand -base64 32  # → IMPERSONATION_TOKEN_SECRET
```

---

## 4. Phase 2 — Database (Supabase)

**Time:** ~15 minutes | **Cost:** $0

### 4.1 Database Status

> ✅ **Already Done:** 51 tables + 1 materialized view migrated on Supabase.

### 4.2 Production Hardening

```sql
-- Run in Supabase SQL Editor

-- 1. Ensure connection pooler is enabled
-- Dashboard → Settings → Database → Connection Pooling → Mode: Transaction

-- 2. Enable Row Level Security on critical tables
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

-- 3. Create read-only role for analytics
CREATE ROLE ssl_analytics LOGIN PASSWORD 'strong_password_here';
GRANT CONNECT ON DATABASE postgres TO ssl_analytics;
GRANT USAGE ON SCHEMA public TO ssl_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ssl_analytics;
```

### 4.3 Backup Configuration

- **Supabase Free Tier:** 7-day automatic backups
- **Supabase Pro ($25/mo):** Point-in-time recovery (PITR) — recommended for production
- **Manual Export:** Schedule weekly `pg_dump` via cron on VPS as additional safety:

```bash
# Add to VPS crontab (runs every Sunday at 3 AM)
0 3 * * 0 pg_dump "$DATABASE_URL" | gzip > ~/backups/ssl_$(date +\%Y\%m\%d).sql.gz
```

---

## 5. Phase 3 — Backend VPS

**Time:** ~45 minutes | **Cost:** $0

> 🎓 **Student Advantage:** You have TWO free VPS options. We recommend DigitalOcean as primary (more reliable, better network) with Oracle Cloud as backup.

### 5.1 Option A: DigitalOcean Droplet (🎓 Recommended with Student Pack)

**Why DigitalOcean over Oracle Free?** More reliable uptime, better network performance, simpler dashboard, and your $200 student credit covers ~16 months of a production-grade droplet.

1. **Activate student credit:** https://education.github.com/pack → DigitalOcean
2. **Create Droplet:**
   - **Image:** Ubuntu 24.04 LTS
   - **Plan:** Regular → **$12/mo** (2 vCPU, 4GB RAM, 80GB SSD) — *or* $24/mo (4GB+, 4 vCPU) for more headroom
   - **Region:** Bangalore (SGP1) or London (LON1) — closest to Pakistan
   - **Authentication:** SSH Key
3. **Add Block Storage:** 50GB ($5/mo) for Docker volumes if needed
4. **Enable Monitoring:** Free built-in CPU/memory/disk alerts
5. **Enable Backups:** $2.40/mo (weekly snapshots) — highly recommended

**Cost with student credit:** `$12/mo × 16 months = $192` — fully covered by $200 credit.

### 5.1 Option B: Oracle Cloud (Free Tier Backup)

1. **Log in:** https://cloud.oracle.com → Compute → Create Instance
2. **Image:** Canonical Ubuntu 22.04 (or 24.04)
3. **Shape:** `VM.Standard.A1.Flex` — **4 OCPUs, 24GB RAM** (Always Free)
4. **Boot Volume:** 200GB (Always Free up to 200GB)
5. **Networking:** Create VCN with public subnet
6. **SSH Key:** Generate and download `.pem` key

> ⚠️ Oracle free tier can be reclaimed if idle. Use as backup only.

### 5.2 Configure Firewall Rules

**Oracle Cloud Console → Networking → Virtual Cloud Network → Security Lists:**

| Protocol | Port Range          | Source    | Purpose                |
|----------|---------------------|-----------|------------------------|
| TCP      | 22                  | Your IP   | SSH access             |
| TCP      | 80                  | 0.0.0.0/0 | HTTP → HTTPS redirect  |
| TCP      | 443                 | 0.0.0.0/0 | HTTPS (Nginx)          |
| UDP      | 40000-49999         | 0.0.0.0/0 | WebRTC media (streaming) |

> **⚠️ Important:** Do NOT open 3000, 4000, 4002, 5432, 6379 externally. All traffic goes through Nginx on 80/443.

### 5.3 Server Setup

```bash
# SSH into VPS
ssh -i ~/your-key.pem ubuntu@<VPS_PUBLIC_IP>

# ── System Update ──
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw htop

# ── Install Docker ──
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# ── Install Node.js 22 + pnpm (for migrations) ──
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm@9.15.0

# ── Configure Firewall (UFW) ──
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 40000:49999/udp   # WebRTC
sudo ufw --force enable
sudo ufw status

# ── Set Swap (recommended for 24GB instances) ──
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 5.4 Clone & Configure

```bash
# Clone project
git clone https://github.com/Kaashmalik/mtk-ssl2026.git
cd mtk-ssl

# Create production env from template
cp .env.production .env.prod

# Edit with your real values
nano .env.prod
```

**Critical `.env.prod` values to set:**

```env
# Database (Supabase)
DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Auth (Clerk LIVE keys)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Secrets (auto-generated)
CRON_SECRET=<generated-secret-1>
SSL_ADMIN_TOKEN=<generated-secret-2>
IMPERSONATION_TOKEN_SECRET=<generated-secret-3>

# Domains
NEXT_PUBLIC_APP_URL=https://ssl.mtkcodex.site
NEXT_PUBLIC_API_URL=https://api.ssl.mtkcodex.site
NEXT_PUBLIC_WS_URL=wss://ws.ssl.mtkcodex.site
CORS_ORIGINS=https://ssl.mtkcodex.site,https://admin.ssl.mtkcodex.site

# Streaming (IMPORTANT: set to VPS public IP)
MEDIASOUP_ANNOUNCED_IP=<VPS_PUBLIC_IP>

# Monitoring
SENTRY_DSN=https://xxx@sentry.io/xxx
```

### 5.5 Deploy Backend Services

```bash
# Option A: Use the deploy script (recommended)
bash deploy-vps.sh --phase core

# Option B: Manual step-by-step
# 1. Build images
docker compose -f docker-compose.prod.yml --env-file .env.prod build --parallel

# 2. Start infrastructure
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis kafka zookeeper

# 3. Wait for readiness
sleep 30

# 4. Run migrations (if not already done via Supabase)
pnpm --filter @mtk/database migrate
# SSL Supabase (anxstufkbqnjkxgksfkn): 024_revoke_sensitive_table_grants.sql applied 2026-09-23

# 5. Start all services
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 6. Verify
docker compose -f docker-compose.prod.yml ps
```

### 5.6 Verify Backend Health

```bash
curl http://localhost:3000/api/v1/health   # API Gateway
curl http://localhost:4000/api/health      # Main API
curl http://localhost:4002/health          # Scoring Service

# All should return: {"status":"ok"} or {"status":"healthy"}
```

---

## 6. Phase 4 — DNS & SSL (Cloudflare)

**Time:** ~15 minutes | **Cost:** $0

### 6.1 Add Domain to Cloudflare

1. Go to https://dash.cloudflare.com
2. **Add a Site** → enter `mtkcodex.site`
3. Select **Free** plan
4. Update your domain registrar's nameservers to the ones Cloudflare provides

### 6.2 Configure DNS Records

| Type      | Name                     | Content                  | Proxy    |
|-----------|--------------------------|--------------------------|----------|
| **A**     | `ssl.mtkcodex.site`      | *(managed by Vercel)*    | —        |
| **A**     | `api.ssl.mtkcodex.site`  | `<VPS_PUBLIC_IP>`        | 🟠 Proxied |
| **A**     | `ws.ssl.mtkcodex.site`   | `<VPS_PUBLIC_IP>`        | 🟠 Proxied |
| **CNAME** | `admin.ssl.mtkcodex.site`| `cname.vercel-dns.com`   | ❌ DNS Only |

> **Note:** For Vercel apps, the DNS record type depends on Vercel's instructions. Typically CNAME for subdomains.

### 6.3 SSL/TLS Settings

1. **SSL/TLS → Overview:** Set mode to **Full (Strict)**
2. **SSL/TLS → Edge Certificates:**
   - ✅ Always Use HTTPS
   - ✅ Automatic HTTPS Rewrites
   - ✅ TLS 1.3
   - ✅ Opportunistic Encryption
3. **Security → WAF:** Enable managed rules (free tier includes basic WAF)
4. **Speed → Optimization:**
   - ✅ Auto Minify (JS, CSS, HTML)
   - ✅ Brotli compression
   - ✅ Early Hints

### 6.4 SSL Certificates for Nginx (VPS)

**Option A: Cloudflare Origin Certificate (Recommended)**

1. SSL/TLS → Origin Server → Create Certificate
2. Generate for: `*.ssl.mtkcodex.site`, `ssl.mtkcodex.site`
3. Download `cert.pem` and `key.pem`
4. Copy to VPS:

```bash
mkdir -p ~/mtk-ssl/nginx/ssl
# Upload cert.pem and key.pem to ~/mtk-ssl/nginx/ssl/
scp cert.pem ubuntu@<VPS_IP>:~/mtk-ssl/nginx/ssl/cert.pem
scp key.pem ubuntu@<VPS_IP>:~/mtk-ssl/nginx/ssl/key.pem
```

5. Restart Nginx:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart nginx
```

**Option B: Let's Encrypt (if not using Cloudflare proxy)**

```bash
sudo apt install certbot
sudo certbot certonly --standalone \
  -d api.ssl.mtkcodex.site \
  -d ws.ssl.mtkcodex.site
cp /etc/letsencrypt/live/api.ssl.mtkcodex.site/fullchain.pem ~/mtk-ssl/nginx/ssl/cert.pem
cp /etc/letsencrypt/live/api.ssl.mtkcodex.site/privkey.pem ~/mtk-ssl/nginx/ssl/key.pem
```

---

## 7. Phase 5 — Frontend Deployment (Vercel)

**Time:** ~20 minutes | **Cost:** $0 (🎓 Student Pack = Pro for free!)

### 7.1 Deploy `apps/web` (Main Web App)

1. **Vercel Dashboard** → New Project → Import `Kaashmalik/mtk-ssl`
2. **Framework Preset:** Next.js
3. **Root Directory:** `apps/web`
4. **Build Command:** `cd ../.. && pnpm turbo build --filter=@mtk/web`
5. **Install Command:** `cd ../.. && pnpm install`
6. **Output Directory:** `.next` (auto-detected)
7. **Environment Variables:**

| Variable                              | Value                                    |
|---------------------------------------|------------------------------------------|
| `APP_ENV`                             | `production`                             |
| `NEXT_PUBLIC_API_URL`                 | `https://api.ssl.mtkcodex.site`          |
| `NEXT_PUBLIC_WS_URL`                  | `wss://ws.ssl.mtkcodex.site`             |
| `SCORING_SERVICE_URL`                 | `https://api.ssl.mtkcodex.site` (or scoring URL) |
| `SCORING_GATEWAY_TOKEN`               | same secret as Nest scoring-service      |
| `NEXT_PUBLIC_SCORING_WS_TOKEN`        | same as `SCORING_GATEWAY_TOKEN`          |
| `ONLINE_PAYMENTS_ENABLED`             | `false` (manual proofs until online live)|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`   | `pk_live_...`                            |
| `CLERK_SECRET_KEY`                    | `sk_live_...`                            |
| `NEXT_PUBLIC_SUPABASE_URL`            | `https://xxx.supabase.co`                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | `eyJ...`                                 |
| `DATABASE_URL`                        | `postgresql://...` (for server actions)   |
| `SENTRY_DSN`                          | `https://xxx@sentry.io/xxx`              |
| `SENTRY_AUTH_TOKEN`                   | `sntrys_...` (for source maps)           |

8. **Deploy** → Add custom domain `ssl.mtkcodex.site`

### 7.2 Deploy `apps/admin` (Admin Dashboard)

1. **Vercel Dashboard** → New Project → Same repo
2. **Root Directory:** `apps/admin`
3. **Build Command:** `cd ../.. && pnpm turbo build --filter=@mtk/admin`
4. **Install Command:** `cd ../.. && pnpm install`
5. Same environment variables as web app
6. **Deploy** → Add custom domain `admin.ssl.mtkcodex.site`

### 7.3 Deploy `apps/marketing` (Marketing Site)

1. **Vercel Dashboard** → New Project → Same repo
2. **Root Directory:** `apps/marketing`
3. **Build Command:** `cd ../.. && pnpm turbo build --filter=@mtk/marketing`
4. **Install Command:** `cd ../.. && pnpm install`
5. Minimal env vars (public keys only)
6. **Deploy** → Add custom domain if separate (or use `ssl.mtkcodex.site` root)

### 7.4 Vercel Configuration Tips

- **🎓 Student Pro Perks:** You get these for free with student pack:
  - **Vercel Analytics** — Web Vitals tracking for all 3 apps
  - **Vercel Speed Insights** — real-user performance monitoring
  - **Password Protection** — lock preview deployments
  - **10x Bandwidth** — 1TB/mo instead of 100GB
  - **Concurrent Builds** — faster deploys
- **Enable Deployment Protection:** Settings → Deployment Protection → Vercel Authentication (for preview deployments)
- **GitHub Integration:** Auto-deploys on push to `main` branch
- **Monorepo:** Each app deploys independently — use **Ignored Build Step** to skip unchanged apps:
  ```bash
  # In Vercel project settings → General → Ignored Build Step:
  npx turbo-ignore @mtk/web    # (for web project)
  npx turbo-ignore @mtk/admin  # (for admin project)
  ```

---

## 8. Phase 6 — Mobile App (EAS / Play Store)

**Time:** ~2-4 hours (incl. Google review) | **Cost:** $25 one-time

### 8.1 Configure EAS Secrets

```bash
cd apps/mobile

# Set production secrets
eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value "https://api.ssl.mtkcodex.site"
eas secret:create --scope project --name EXPO_PUBLIC_WS_URL --value "wss://ws.ssl.mtkcodex.site"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://xxx.supabase.co"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJ..."
eas secret:create --scope project --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value "pk_live_..."
```

### 8.2 Build Production APK/AAB

```bash
# Build Android production bundle
eas build --platform android --profile production

# This produces an .aab file optimized for Google Play
```

### 8.3 Submit to Google Play Store

1. **Create Developer Account:** https://play.google.com/console ($25 one-time)
2. **Create App** → Fill in store listing (title, description, screenshots)
3. **Upload App Bundle:** Use EAS submit or manual upload
4. **Content Rating:** Complete questionnaire
5. **Pricing:** Set as Free
6. **Submit for Review**

```bash
# Automated submission via EAS
eas submit --platform android --profile production
```

### 8.4 iOS (Future — When Ready)

```bash
# Requires Apple Developer account ($99/year)
eas build --platform ios --profile production
eas submit --platform ios
```

---

## 9. Phase 7 — CI/CD Pipeline

**Time:** ~30 minutes | **Already configured in `.github/workflows/ci-cd.yaml`**

### 9.1 Pipeline Overview

```
Push to main
    │
    ├─→ Lint & Type Check
    ├─→ Security Scan (Gitleaks + pnpm audit + Trivy)
    │
    ├─→ Unit Tests (with coverage)
    │
    ├─→ Build All (Turborepo cached)
    │
    ├─→ Build Docker Images (matrix: 7 services)
    │     └─→ Push to Container Registry (GCR)
    │     └─→ Trivy Image Scan
    │
    ├─→ Deploy to Staging
    │     └─→ E2E Tests (Playwright)
    │
    └─→ Deploy to Production (manual approval)
```

### 9.2 Required GitHub Secrets

Set these in **GitHub → Settings → Secrets and variables → Actions:**

| Secret                               | Value                                     |
|---------------------------------------|-------------------------------------------|
| `CLERK_SECRET_KEY`                    | `sk_live_...`                             |
| `DATABASE_URL`                        | Supabase connection string                |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`   | `pk_live_...`                             |
| `NEXT_PUBLIC_SUPABASE_URL`            | `https://xxx.supabase.co`                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | `eyJ...`                                 |
| `SENTRY_DSN`                          | Sentry DSN                                |
| `SENTRY_AUTH_TOKEN`                   | Sentry auth token                         |
| `GCP_PROJECT_ID`                      | *(if using GCR for Docker images)*       |
| `GCP_SA_KEY`                          | *(GCP service account JSON)*             |
| `TURBO_TOKEN`                         | *(optional: Turborepo remote cache)*     |
| `SNYK_TOKEN`                          | *(optional: Snyk security scanning)*     |

### 9.3 VPS Auto-Deploy (Lightweight Alternative to K8s)

For VPS-based deployment without Kubernetes, add a webhook-triggered deploy:

```bash
# On VPS: Create deploy webhook script
cat > ~/deploy-hook.sh << 'EOF'
#!/bin/bash
cd ~/mtk-ssl
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.prod build --parallel
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker image prune -f
echo "Deployed at $(date)" >> ~/deploy.log
EOF
chmod +x ~/deploy-hook.sh
```

Add a GitHub Actions step to SSH-trigger the deploy after build:

```yaml
# Add to .github/workflows/ci-cd.yaml after build job
deploy-vps:
  name: Deploy Backend to VPS
  runs-on: ubuntu-latest
  needs: build
  if: github.ref == 'refs/heads/main'
  steps:
    - name: Deploy via SSH
      uses: appleboy/ssh-action@v1
      with:
        host: ${{ secrets.VPS_HOST }}
        username: ubuntu
        key: ${{ secrets.VPS_SSH_KEY }}
        script: bash ~/deploy-hook.sh
```

---

## 10. Phase 8 — Monitoring & Observability

**Time:** ~30 minutes | **Cost:** $0 (🎓 Student Pack = enterprise-grade monitoring free)

### 10.1 Sentry (Error Tracking) — 🎓 Upgraded to Team Plan

> **Student Perk:** 500K events/month free (vs 5K on free tier). This is **100x more capacity.**

- Verify errors appear: https://sentry.io
- Set up alert rules for critical errors
- Configure source maps upload in Vercel build
- **Student Extra:** Performance monitoring, session replay, and release tracking included

### 10.2 DataDog (🎓 Recommended — Replaces Prometheus/Grafana)

> **Student Perk:** DataDog Pro plan free for 2 years ($15/host/mo value). This is industry-standard APM used by Netflix, Airbnb, Samsung.

**Setup:**
1. Sign up at https://datadoghq.com with student verification
2. Install the DataDog agent on your VPS:

```bash
# On VPS — one-command install
DD_API_KEY=<your-datadog-api-key> \
DD_SITE="datadoghq.com" \
bash -c "$(curl -L https://install.datadoghq.com/scripts/install_script_agent7.sh)"
```

3. Enable Docker integration (auto-discovers all containers):
```bash
sudo usermod -a -G docker dd-agent
sudo systemctl restart datadog-agent
```

**What you get for free as a student:**
- 📊 **Infrastructure Metrics** — CPU, memory, disk, network per container
- 🔍 **APM Traces** — request traces across all 10 microservices
- 📝 **Log Management** — centralized logs with search and alerting
- 🚨 **Alerting** — PagerDuty-style alerts when services go down
- 📈 **Dashboards** — pre-built Docker, Node.js, Nginx dashboards

### 10.2b Prometheus + Grafana (Self-Hosted Alternative)

If you prefer self-hosted monitoring instead of DataDog:

```bash
# On VPS, add to docker-compose.prod.yml (or create monitoring overlay)
# Pre-built configs exist in: infrastructure/monitoring/

# Quick setup:
docker run -d \
  --name prometheus \
  --network ssl-prod-network \
  -p 9090:9090 \
  -v ~/mtk-ssl/infrastructure/monitoring/prometheus-rules.yaml:/etc/prometheus/prometheus.yml \
  prom/prometheus

docker run -d \
  --name grafana \
  --network ssl-prod-network \
  -p 3030:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=secure_password \
  grafana/grafana
```

Import the pre-built dashboard: `infrastructure/monitoring/grafana-dashboards.json`

### 10.3 Uptime Monitoring (🎓 Better Stack — Free 1 Year)

> **Student Perk:** Better Stack free for 1 year (normally $24/mo). Includes uptime monitoring + incident management + status page.

| Service                          | URL to Monitor                                  | Student? |
|----------------------------------|------------------------------------------------|----------|
| **Better Stack** (🎓 free 1yr)   | `https://api.ssl.mtkcodex.site/api/health`     | ✅       |
| **Better Stack** (🎓 free 1yr)   | `https://ssl.mtkcodex.site`                    | ✅       |
| **Better Stack** (🎓 free 1yr)   | `wss://ws.ssl.mtkcodex.site`                   | ✅       |
| **UptimeRobot** (free backup)    | Same URLs as above                              | —        |

### 10.4 Log Management

```bash
# View live logs on VPS
docker compose -f docker-compose.prod.yml logs -f --tail=100

# Service-specific logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f scoring-service

# Log rotation (prevent disk filling)
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
EOF
sudo systemctl restart docker
```

---

## 11. Phase 9 — Security Hardening

### 11.1 VPS Security

```bash
# ── Disable root login ──
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# ── Enable automatic security updates ──
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# ── Install fail2ban ──
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 11.2 Application Security Checklist

- [x] **CORS:** Restricted to production domains only (`CORS_ORIGINS` in `.env.prod`)
- [x] **Rate Limiting:** Nginx (`100r/s` API, `1000r/s` WebSocket) + Upstash Redis middleware
- [x] **WAF:** Nginx `waf-security.conf` blocks SQLi, XSS, bad bots
- [x] **Security Headers:** `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`
- [x] **TLS 1.2+:** Enforced in Nginx and Cloudflare
- [x] **Secret Scanning:** Gitleaks runs on every commit in CI
- [x] **Dependency Audit:** `pnpm audit` runs in CI, blocks on high/critical
- [x] **Container Scanning:** Trivy scans Docker images in CI
- [ ] **Rotate all placeholder secrets** before go-live
- [ ] **Enable Clerk Production mode** with live keys
- [ ] **Configure Stripe webhook** endpoint on production domain

### 11.3 Data Security

- [ ] Supabase: Enable Point-in-Time Recovery (Pro plan, $25/mo)
- [ ] Set up weekly `pg_dump` cron as backup belt-and-suspenders
- [ ] Enable Supabase database audit logging
- [ ] Test database restore procedure at least once

---

## 12. Phase 10 — Post-Launch Operations

### 12.1 Clerk Production Setup

1. Dashboard → Create **Production** instance
2. Configure allowed origins:
   - `https://ssl.mtkcodex.site`
   - `https://admin.ssl.mtkcodex.site`
3. Set up social login providers (Google, etc.)
4. Configure branding (logo, colors)

### 12.2 Stripe Webhook Setup

1. https://dashboard.stripe.com/webhooks → Add endpoint
2. URL: `https://api.ssl.mtkcodex.site/payments/webhook`
3. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`
4. Copy webhook signing secret → update `STRIPE_WEBHOOK_SECRET` in `.env.prod`
5. Restart payment service:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart payment-service
```

### 12.3 Create First Admin User

```bash
# Via Clerk dashboard: create user with email kaash0542@gmail.com
# The SUPER_ADMIN_EMAIL in .env matches this email

# Or via API:
curl -X POST https://api.ssl.mtkcodex.site/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"kaash0542@gmail.com"}'
```

### 12.4 Automated Updates

```bash
# Create update script on VPS
cat > ~/update-ssl.sh << 'EOF'
#!/bin/bash
set -e
cd ~/mtk-ssl
echo "$(date): Starting update..." >> ~/update.log

git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.prod build --parallel
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker image prune -f

echo "$(date): Update complete" >> ~/update.log
echo "Service status:"
docker compose -f docker-compose.prod.yml ps
EOF
chmod +x ~/update-ssl.sh
```

---

## 13. Cost Summary

### 🎓 Student Pack Stack (Day 1 — YOUR Recommended Setup)

| Resource              | Provider                | Normal Cost  | Student Cost  | Saving         |
|-----------------------|-------------------------|-------------|--------------|----------------|
| Frontend (3 apps)     | Vercel **Pro** 🎓       | $20/mo      | **$0**       | 🎓 $20/mo saved |
| Backend VPS           | DigitalOcean 🎓         | $12/mo      | **$0**       | 🎓 $200 credit  |
| Database              | Supabase Free           | $0          | **$0**       | —              |
| DNS + CDN + WAF       | Cloudflare Free         | $0          | **$0**       | —              |
| Auth                  | Clerk Free              | $0          | **$0**       | —              |
| Error Tracking        | Sentry **Team** 🎓      | $26/mo      | **$0**       | 🎓 $26/mo saved |
| APM + Monitoring      | DataDog **Pro** 🎓      | $15/mo      | **$0**       | 🎓 $15/mo saved |
| Uptime Monitoring     | Better Stack 🎓         | $24/mo      | **$0**       | 🎓 $24/mo saved |
| Secrets Manager       | 1Password 🎓            | $3/mo       | **$0**       | 🎓 $3/mo saved  |
| CI/CD                 | GitHub **Pro** 🎓       | $4/mo       | **$0**       | 🎓 $4/mo saved  |
| AI Coding             | GitHub Copilot 🎓       | $10/mo      | **$0**       | 🎓 $10/mo saved |
| Domain                | Namecheap 🎓 `.me`      | $10/yr      | **$0**       | 🎓 Free 1 year  |
| Mobile Builds         | Expo EAS Free           | $0          | **$0**       | —              |
| **Monthly Total**     |                         | **$114/mo** | **$0/mo** 🎉| **$114/mo saved** |

**One-time costs:**
- Google Play Developer: **$25**

**Total value unlocked by Student Pack: ~$1,368/year in free tools 🎓**

### Growth Tier (When scaling — 1000+ users, after student credits expire)

| Resource              | Provider           | Monthly Cost |
|-----------------------|--------------------|-------------|
| Frontend (3 apps)     | Vercel Pro         | **$20**     |
| Database              | Supabase Pro       | **$25**     |
| Backend VPS           | DigitalOcean       | **$24**     |
| DNS + CDN + WAF       | Cloudflare Free    | **$0**      |
| Auth                  | Clerk Pro          | **$25**     |
| Error Tracking        | Sentry Team        | **$26**     |
| Monitoring            | DataDog (self-host)| **$0**      |
| **Monthly Total**     |                    | **~$120/mo**|

### Enterprise Tier (10,000+ users, SLA required)

| Resource              | Provider                 | Monthly Cost |
|-----------------------|--------------------------|-------------|
| Frontend              | Vercel Enterprise        | **$150+**   |
| Database              | Supabase Team / AWS RDS  | **$75+**    |
| Backend               | AWS ECS / GKE Kubernetes | **$200+**   |
| CDN + WAF             | Cloudflare Pro           | **$20**     |
| Auth                  | Clerk Enterprise         | Custom      |
| Monitoring            | Datadog / New Relic      | **$100+**   |
| **Monthly Total**     |                          | **$500+**   |

---

## 14. Quick Reference Commands

### VPS Management

```bash
# ── Deploy / Update ──
cd ~/mtk-ssl
git pull && bash deploy-vps.sh --phase core     # Deploy core services
git pull && bash deploy-vps.sh --phase all       # Deploy everything
bash ~/update-ssl.sh                              # Quick update script

# ── Service Control ──
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d      # Start all
docker compose -f docker-compose.prod.yml --env-file .env.prod down        # Stop all
docker compose -f docker-compose.prod.yml --env-file .env.prod restart     # Restart all
docker compose -f docker-compose.prod.yml restart scoring-service          # Restart one

# ── Monitoring ──
docker compose -f docker-compose.prod.yml ps          # Service status
docker compose -f docker-compose.prod.yml logs -f     # All logs
docker compose -f docker-compose.prod.yml logs -f api # Single service log
docker stats                                            # Resource usage

# ── Database ──
pnpm --filter @mtk/database migrate                   # Run migrations

# ── Maintenance ──
docker image prune -a                                  # Clean old images
docker system df                                       # Disk usage
```

### Local Development → Production Flow

```bash
# 1. Develop locally
pnpm dev

# 2. Test build
pnpm build

# 3. Push to GitHub
git add . && git commit -m "feat: ..." && git push

# 4. CI/CD pipeline runs automatically:
#    Lint → Test → Security → Build → Deploy Staging → E2E → Deploy Prod

# 5. Vercel auto-deploys frontend on push to main
# 6. VPS deploy via SSH action (or manual bash deploy-vps.sh)
```

---

## 15. Troubleshooting Playbook

### Problem: Service won't start

```bash
# 1. Check logs
docker compose -f docker-compose.prod.yml logs <service-name> --tail 50

# 2. Check environment variables
docker compose -f docker-compose.prod.yml exec <service-name> env

# 3. Check health
curl http://localhost:<port>/health

# 4. Restart
docker compose -f docker-compose.prod.yml restart <service-name>

# 5. Rebuild from scratch
docker compose -f docker-compose.prod.yml build --no-cache <service-name>
docker compose -f docker-compose.prod.yml up -d <service-name>
```

### Problem: Database connection refused

```bash
# Check Supabase status: https://status.supabase.com
# Test connection from VPS:
psql "$DATABASE_URL" -c "SELECT 1;"

# If using self-hosted Postgres:
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs postgres
```

### Problem: WebSocket not connecting

```bash
# 1. Verify scoring service is running
curl http://localhost:4002/health

# 2. Test WebSocket locally
npx wscat -c ws://localhost:4002/scoring

# 3. Check Cloudflare WebSocket setting:
#    Network → WebSockets → Enabled ✅

# 4. Check Nginx config has proper upgrade headers:
#    proxy_set_header Upgrade $http_upgrade;
#    proxy_set_header Connection "upgrade";
```

### Problem: Vercel build fails

```bash
# Common fix: ensure monorepo install command is correct
# Install Command: cd ../.. && pnpm install
# Build Command:   cd ../.. && pnpm turbo build --filter=@mtk/web

# Check if the package name matches:
cat apps/web/package.json | grep '"name"'
# Must match the --filter value
```

### Problem: Out of memory on VPS

```bash
# Check memory
free -h
docker stats --no-stream

# Stop non-essential services
docker compose -f docker-compose.prod.yml stop \
  ai-commentary-service analytics-service streaming-service

# Increase swap
sudo fallocate -l 8G /swapfile2
sudo chmod 600 /swapfile2
sudo mkswap /swapfile2
sudo swapon /swapfile2
```

### Problem: SSL certificate errors

```bash
# Check cert expiry
openssl s_client -connect api.ssl.mtkcodex.site:443 -servername api.ssl.mtkcodex.site 2>/dev/null | openssl x509 -noout -dates

# Regenerate Cloudflare Origin Certificate (15-year validity)
# Cloudflare → SSL/TLS → Origin Server → Create Certificate

# Copy new certs to VPS
scp cert.pem ubuntu@<VPS_IP>:~/mtk-ssl/nginx/ssl/cert.pem
scp key.pem ubuntu@<VPS_IP>:~/mtk-ssl/nginx/ssl/key.pem
docker compose -f docker-compose.prod.yml restart nginx
```

---

## 16. Go-Live Day Checklist

### T-minus 1 week

- [ ] All features tested on staging
- [ ] Load test completed (k6 or Artillery)
- [ ] Security audit completed (gitleaks + pnpm audit clean)
- [ ] Database backup tested (restore procedure verified)
- [ ] Monitoring alerts configured (🎓 Sentry Team + DataDog + Better Stack)
- [ ] Clerk production instance created with live keys
- [ ] Domain DNS propagated (check with `dig ssl.mtkcodex.site`)
- [ ] 🎓 All Student Pack perks activated (see Section 17)

### T-minus 1 day

- [ ] Final `pnpm build` succeeds for all apps
- [ ] All Docker images build successfully on VPS (DigitalOcean or Oracle)
- [ ] `.env.prod` has all real values (no placeholders)
- [ ] SSL certificates installed and verified
- [ ] Stripe webhook configured and tested
- [ ] Mobile APK built and submitted to Google Play
- [ ] DataDog agent installed and receiving metrics

### Go-Live Day (D-Day)

```
✅ STEP 1: Deploy backend
   $ ssh ubuntu@<VPS> 'cd mtk-ssl && bash deploy-vps.sh --phase all'

✅ STEP 2: Verify backend health
   $ curl https://api.ssl.mtkcodex.site/api/health
   $ curl https://api.ssl.mtkcodex.site/api/v1/health

✅ STEP 3: Verify WebSocket
   $ npx wscat -c wss://ws.ssl.mtkcodex.site

✅ STEP 4: Deploy frontends (push to main or trigger Vercel deploy)
   $ git push origin main

✅ STEP 5: Verify frontends
   Open: https://ssl.mtkcodex.site
   Open: https://admin.ssl.mtkcodex.site

✅ STEP 6: Create admin user & verify login flow
   - Sign up via Clerk on ssl.mtkcodex.site
   - Verify role assignment (SUPER_ADMIN_EMAIL match)

✅ STEP 7: Smoke test critical flows
   - Create a team
   - Add players
   - Create a match
   - Test live scoring
   - Verify WebSocket updates

✅ STEP 8: Enable monitoring
   - Verify Sentry captures a test error
   - Verify UptimeRobot monitors are green
   - Check docker stats on VPS

✅ STEP 9: Announce launch! 🎉
```

### Post-Launch (First 48 hours)

- [ ] Monitor Sentry for new errors every 4 hours
- [ ] Check VPS resource usage (`docker stats`)
- [ ] Verify automatic backups are running
- [ ] Monitor Vercel analytics for frontend performance
- [ ] Respond to first user feedback
- [ ] Keep deploy-hook ready for hotfixes

---

## 📎 Related Documentation

| Document                          | Purpose                           |
|-----------------------------------|-----------------------------------|
| `DEPLOY.md`                       | Detailed Docker deployment guide  |
| `DEPLOYMENT.md`                   | Architecture & scaling reference  |
| `GO-LIVE-CHECKLIST.md`            | Quick-reference checklist         |
| `ENV_SETUP_GUIDE.md`              | Environment variable reference    |
| `SUPABASE_SETUP.md`               | Database configuration            |
| `WHITE_LABEL_IMPLEMENTATION.md`   | Multi-tenant customization        |
| `.github/workflows/ci-cd.yaml`   | CI/CD pipeline definition         |
| `docker-compose.prod.yml`        | Production Docker Compose         |
| `deploy-vps.sh`                   | Automated VPS deploy script       |
| `nginx/nginx.conf`               | Reverse proxy configuration       |

---

> **🎯 Bottom Line:** With your **GitHub Student Developer Pack**, you're launching with a **$114/month premium stack for $0**. DigitalOcean ($200 credit) runs your backend for 16 months free, Vercel Pro handles frontends with 10x bandwidth, DataDog gives you Netflix-grade monitoring, and Sentry Team tracks 500K events/month. The only cost is Google Play ($25 one-time). That's **~$1,368/year in free tools** — a production setup that rivals funded startups. 🎓🚀
