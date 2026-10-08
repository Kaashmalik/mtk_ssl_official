# SSL Deployment Guide

## Overview

This guide covers deploying the Shakir Super League (SSL) application to production using Docker Compose.

## Prerequisites

- Docker 24.x or later
- Docker Compose 2.x or later
- Minimum 4GB RAM, 2 CPU cores
- SSL certificates for HTTPS (Let's Encrypt or custom)
- Domain name configured with DNS

## Deployment Checklist

### Phase 1: Environment Setup

1. **Clone and prepare the repository:**
```bash
cd d:\MalikTech\mtk-ssl
pnpm install
```

2. **Create production environment file:**
```bash
cp .env.example .env.prod
```

3. **Edit `.env.prod` with your secrets:**
```env
# Database
POSTGRES_USER=ssl
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=ssl_prod

# Redis (no auth needed by default)

# Kafka (no auth needed by default)

# ClickHouse
CLICKHOUSE_USER=ssl
CLICKHOUSE_PASSWORD=your_secure_password_here

# Clerk Authentication
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...

# Stripe Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# JazzCash (Pakistan payments)
JAZZCASH_MERCHANT_ID=your_merchant_id
JAZZCASH_PASSWORD=your_password

# OpenAI (AI Commentary)
OPENAI_API_KEY=sk-...

# Firebase (Push Notifications)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}

# SMTP (Email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Twilio (SMS notifications)
TWILIO_SID=your_account_sid
TWILIO_TOKEN=your_auth_token

# Sentry (Error tracking)
SENTRY_DSN=https://...@sentry.io/...

# WebRTC Streaming (public IP for mediasoup)
MEDIASOUP_ANNOUNCED_IP=your_server_public_ip

# Frontend URLs
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://ws.yourdomain.com
```

### Phase 2: Build Production Images

```bash
# Build all services
docker-compose -f docker-compose.prod.yml build

# Or build specific services
docker-compose -f docker-compose.prod.yml build api-gateway scoring-service web
```

### Phase 3: Database Migrations

```bash
# Start infrastructure first
docker-compose -f docker-compose.prod.yml up -d postgres redis kafka clickhouse

# Wait 30 seconds for services to be ready
sleep 30

# Run database migrations
pnpm --filter @mtk/database migrate
```

### Phase 4: Deploy All Services

```bash
# Deploy everything
docker-compose -f docker-compose.prod.yml up -d

# Check service status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f api-gateway
docker-compose -f docker-compose.prod.yml logs -f scoring-service
```

### Phase 5: Verify Deployment

```bash
# Health checks
curl http://localhost:3000/api/v1/health        # API Gateway
curl http://localhost:4000/health                # Scoring Service
curl http://localhost:3001/api/health            # Web App

# Check all services are running
docker-compose -f docker-compose.prod.yml ps
```

## Service URLs (Production)

| Service | Internal Port | External Access |
|---------|--------------|-----------------|
| Web App | 3001 | https://yourdomain.com |
| API Gateway | 3000 | https://api.yourdomain.com |
| Scoring HTTP | 4000 | Internal only |
| Scoring WebSocket | 4001 | wss://ws.yourdomain.com |
| Auth Service | 5001 | Internal only |
| Tournament Service | 5002 | Internal only |
| Payment Service | 5004 | Internal only |
| Notification Service | 5005 | Internal only |
| AI Commentary | 5006 | Internal only |
| Analytics Service | 5007 | Internal only |
| Streaming Service | 5008 | Internal only |

## Scaling Considerations

### Horizontal Scaling (Kubernetes Recommended)

For high-traffic deployments, migrate to Kubernetes:

```yaml
# Example: scoring-service deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: scoring-service
spec:
  replicas: 3  # Scale to 3 instances
  selector:
    matchLabels:
      app: scoring-service
  template:
    spec:
      containers:
      - name: scoring-service
        image: ssl/scoring-service:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

### Database Scaling

- **PostgreSQL**: Use managed service (AWS RDS, GCP Cloud SQL) or Citus for sharding
- **Redis**: Use Redis Cluster or managed Redis (AWS ElastiCache)
- **ClickHouse**: Use ClickHouse Cloud or cluster setup
- **Kafka**: Use managed Kafka (AWS MSK, Confluent Cloud) or Strimzi operator

## Monitoring & Observability

### Required Setup

1. **Sentry**: Already integrated for error tracking
2. **Prometheus + Grafana**: Add metrics collection
3. **Loki**: Centralized logging
4. **Jaeger**: Distributed tracing

### Health Check Endpoints

All services expose `/health` endpoints for monitoring:

```bash
# Prometheus scrape config
scrape_configs:
  - job_name: 'ssl-services'
    static_configs:
      - targets: 
        - 'api-gateway:3000'
        - 'scoring-service:4000'
        - 'tournament-service:5002'
    metrics_path: /metrics
```

## Security Checklist

- [ ] Change all default passwords
- [ ] Enable SSL/TLS on all endpoints
- [ ] Configure firewall rules (only 80, 443 exposed)
- [ ] Set up DDoS protection (Cloudflare recommended)
- [ ] Enable Sentry for error tracking
- [ ] Rotate secrets regularly
- [ ] Enable audit logging
- [ ] Set up database backups
- [ ] Configure log retention

## Backup Strategy

### Database Backups

```bash
# Automated daily backups (add to cron)
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec ssl-prod-postgres pg_dump -U ssl ssl_prod > backup_$DATE.sql
gzip backup_$DATE.sql
# Upload to S3 or similar
```

### Volume Backups

```bash
# Backup Docker volumes
docker run --rm -v ssl-prod-postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz -C /data .
docker run --rm -v ssl-prod-redis_data:/data -v $(pwd):/backup alpine tar czf /backup/redis_backup.tar.gz -C /data .
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs <service-name>

# Check resource usage
docker stats

# Restart service
docker-compose -f docker-compose.prod.yml restart <service-name>
```

### Database Connection Issues

```bash
# Test connection from service container
docker exec -it ssl-prod-scoring-service sh
wget -qO- http://postgres:5432 || echo "Postgres not reachable"
```

### High Memory Usage

```bash
# Check memory usage
docker system df
docker stats --no-stream

# Prune unused images
docker image prune -a
```

## Update Deployment

```bash
# Pull latest code
git pull origin main

# Rebuild and redeploy
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

# Rolling update (zero downtime for stateless services)
docker-compose -f docker-compose.prod.yml up -d --scale api-gateway=2
# Update one, then the other
docker-compose -f docker-compose.prod.yml up -d --scale api-gateway=1
```

## Support

For deployment issues, check:
1. Service logs: `docker-compose -f docker-compose.prod.yml logs`
2. Resource usage: `docker stats`
3. Network connectivity: `docker network inspect ssl-prod-network`
