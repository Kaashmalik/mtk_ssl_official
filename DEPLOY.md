# SSL Production Deployment

Go-live runbook for Shakir Super League.

**Target:** single VPS (Ubuntu) running Docker Compose + Supabase (managed Postgres)
**Entry point:** `bash deploy-vps.sh --phase all`
**Gate:** `bash scripts/preflight.sh` must pass first

> `deploy.sh` is a deprecated shim that forwards to `deploy-vps.sh`. Use `deploy-vps.sh`.

---

## Domains

| Subdomain | Purpose | Target |
|---|---|---|
| `ssl.mtkcodex.site` | Public web app | Vercel |
| `api.ssl.mtkcodex.site` | REST API | VPS nginx |
| `ws.ssl.mtkcodex.site` | WebSocket (scoring/live) | VPS nginx |
| `gateway.ssl.mtkcodex.site` | API gateway | VPS nginx |

Admin (`apps/admin`) and marketing (`apps/marketing`) deploy to Vercel separately.

---

## Step 1 — VPS prerequisites

On the VPS (Ubuntu 22.04/24.04):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
sudo apt install -y git certbot

git clone <your-repo-url> /opt/mtk-ssl
cd /opt/mtk-ssl
```

Confirm Docker is running:

```bash
docker --version && docker compose version && docker info >/dev/null && echo "daemon OK"
```

---

## Step 2 — Create the production env file

`.env.production` in the repo is a **placeholder template** — it contains no real
credentials. Copy it and fill in real values:

```bash
cd /opt/mtk-ssl
cp .env.production .env.prod
chmod 600 .env.prod
nano .env.prod
```

### Required — deploy will abort without these

| Variable | Source |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (use the **session pooler** URI) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys (`sk_live_…`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys (`pk_live_…`) |
| `STRIPE_SECRET_KEY` | Stripe dashboard → API keys (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → signing secret (`whsec_…`) |
| `SCORING_GATEWAY_TOKEN` | Generate: `openssl rand -hex 32` |
| `STREAMING_ACCESS_TOKEN` | Generate: `openssl rand -hex 32` |
| `MEDIASOUP_ANNOUNCED_IP` | The VPS public IP |

`SCORING_GATEWAY_TOKEN` and `STREAMING_ACCESS_TOKEN` have no external dashboard —
generate them yourself. Both services throw at import in production when they are
missing, so the containers crash-loop without them.

### Strongly recommended

`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `SENTRY_DSN`, `REDIS_URL`,
`KAFKA_BROKERS`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`,
`NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`.

Leave optional integrations commented out if you are not using them yet.

---

## Step 3 — Run migrations

Against Supabase, from your **local** machine or the VPS (needs pnpm + Node 20):

```bash
pnpm install
pnpm --filter @mtk/database migrate
```

Verify tables exist in the Supabase dashboard → Table Editor.

---

## Step 4 — TLS certificate

nginx needs `nginx/ssl/cert.pem` and `nginx/ssl/key.pem`, or it will not start.

Option A — Cloudflare proxy (simplest): set the proxy to **Full (strict)** and
proxy the subdomains; Cloudflare terminates TLS.

Option B — Let's Encrypt on the VPS:

```bash
sudo certbot certonly --standalone \
  -d ssl.mtkcodex.site \
  -d api.ssl.mtkcodex.site \
  -d ws.ssl.mtkcodex.site \
  -d gateway.ssl.mtkcodex.site \
  --agree-tos -m you@example.com

mkdir -p /opt/mtk-ssl/nginx/ssl
sudo cp /etc/letsencrypt/live/ssl.mtkcodex.site/fullchain.pem /opt/mtk-ssl/nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/ssl.mtkcodex.site/privkey.pem  /opt/mtk-ssl/nginx/ssl/key.pem
sudo chmod 644 /opt/mtk-ssl/nginx/ssl/*.pem
```

Renewal (add to crontab):

```bash
0 3 1 * * certbot renew --quiet && systemctl reload nginx
```

---

## Step 5 — DNS

Add A records pointing at the VPS public IP:

```
ssl.mtkcodex.site         -> <VPS IP>
api.ssl.mtkcodex.site     -> <VPS IP>
ws.ssl.mtkcodex.site      -> <VPS IP>
gateway.ssl.mtkcodex.site -> <VPS IP>
```

Wait for propagation, then confirm:

```bash
curl -s https://api.ssl.mtkcodex.site/api/health
```

---

## Step 6 — Preflight (must pass)

```bash
cd /opt/mtk-ssl
bash scripts/preflight.sh
```

This is read-only. It checks tooling, required secrets, placeholder leftovers,
database target, TLS material, compose validity, and port conflicts.

Fix every `✗` and re-run until it reports `READY — 0 blockers`.

---

## Step 7 — Deploy

```bash
cd /opt/mtk-ssl
bash deploy-vps.sh --phase all
```

This builds all images, starts Redis/Kafka, skips the local Postgres (Supabase is
external), runs migrations, starts every service, and health-checks them.

Phases, if you need to go narrower:

| Phase | Starts |
|---|---|
| `infra` | redis, kafka, zookeeper |
| `core` | all 10 services + web + nginx |
| `all` | everything in compose (use this) |
| `frontend` | web + nginx |

---

## Step 8 — Verify

```bash
# Container status
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# Health
curl -s http://localhost:3000/api/v1/health
curl -s http://localhost:4000/api/health
curl -s https://api.ssl.mtkcodex.site/api/health

# Logs for a failing service
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=100 scoring-service
```

The deploy aborts if the API gateway or main API fails its health check.

---

## Step 9 — Frontends (Vercel)

`apps/web` is already linked to a Vercel project. Set these in the Vercel project
settings (Production):

```
NEXT_PUBLIC_API_URL=https://api.ssl.mtkcodex.site
NEXT_PUBLIC_WS_URL=wss://ws.ssl.mtkcodex.site
NEXT_PUBLIC_SUPABASE_URL=<from Supabase>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<from Clerk>
NEXT_PUBLIC_SITE_URL=https://ssl.mtkcodex.site
```

Then link and deploy the other two:

```bash
cd apps/admin    && npx vercel link && npx vercel --prod
cd apps/marketing && npx vercel link && npx vercel --prod
```

---

## Step 10 — Post-deploy

1. **Clerk** — add `ssl.mtkcodex.site` to production allowed origins and redirect URLs.
2. **Stripe** — point the webhook at `https://api.ssl.mtkcodex.site/…` and put the
   signing secret in `.env.prod`, then `docker compose … restart payment-service`.
3. **First admin** — create via the auth setup endpoint or the admin app.
4. **Backups** — Supabase handles these; enable point-in-time recovery.

---

## Updating later

```bash
cd /opt/mtk-ssl
git pull
bash scripts/preflight.sh
bash deploy-vps.sh --phase all
```

### Rollback

```bash
cd /opt/mtk-ssl
git log --oneline -5
git reset --hard <previous-good-sha>
bash deploy-vps.sh --phase all
```

---

## Troubleshooting

**Preflight reports a placeholder secret**
The value still contains `[Get …]`, `[PROJECT…]` or similar. Paste the real value.

**Service crash-looping**
Most often a missing secret. `docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=100 <service>`
and confirm every variable that service's `src/env.ts` requires is set.

**nginx will not start**
`nginx/ssl/cert.pem` and `key.pem` are missing or unreadable. See Step 4.

**`DATABASE_URL` connection refused**
Use the Supabase **session pooler** hostname (`aws-0-…pooler.supabase.com:5432`),
not the direct host. Confirm the password and that the project is not paused.

**Stale env after editing `.env.prod`**
Containers bake env at start time. Re-run the deploy or `docker compose … up -d --force-recreate`.

---

## Related

- `deploy-vps.sh` — canonical deploy script
- `scripts/preflight.sh` — read-only validation
- `docker-compose.prod.yml` — service topology
- `nginx/nginx.conf` — routing and TLS
