# SSL Shakir Super League - Production Requirements

## System Requirements

### Server Specifications (Minimum)

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8+ cores |
| **RAM** | 8 GB | 16+ GB |
| **Storage** | 50 GB SSD | 100+ GB SSD |
| **Network** | 100 Mbps | 1 Gbps |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

### Server Specifications (High Traffic > 10k concurrent users)

| Component | Specification |
|-----------|--------------|
| **CPU** | 16+ cores |
| **RAM** | 32+ GB |
| **Storage** | 500 GB NVMe SSD |
| **Network** | 10 Gbps |
| **Load Balancer** | Nginx or Cloudflare |
| **CDN** | Cloudflare or AWS CloudFront |

---

## Software Requirements

### Required Software Versions

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | 20.x LTS | Runtime for all services |
| **pnpm** | 9.x | Package manager |
| **Docker** | 24.x | Containerization |
| **Docker Compose** | 2.x | Multi-container orchestration |
| **Git** | 2.40+ | Version control |

### Optional Software (Self-Hosted)

| Software | Version | Purpose |
|----------|---------|---------|
| **PostgreSQL** | 16.x | Database (if not using Supabase) |
| **Redis** | 7.x | Cache & sessions |
| **Kafka** | 3.x | Event streaming |
| **ClickHouse** | 24.x | Analytics database |

---

## Port Requirements

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| Web App | 3001 | HTTP/HTTPS | Main fan application |
| Admin Panel | 3002 | HTTP/HTTPS | Super admin dashboard |
| Marketing Site | 3000 | HTTP/HTTPS | Landing page |
| API Gateway | 4000 | HTTP/HTTPS | Main API |
| WebSocket Gateway | 4001 | WS/WSS | Real-time updates |
| Scoring Service | 4002 | HTTP/HTTPS | Ball-by-ball scoring |
| Auth Service | 4003 | HTTP/HTTPS | Authentication |
| Payment Service | 4004 | HTTP/HTTPS | Payment processing |
| AI Commentary | 4005 | HTTP/HTTPS | AI text generation |
| Streaming Service | 4006 | HTTP/HTTPS | WebRTC signaling |
| Analytics Service | 4007 | HTTP/HTTPS | Stats & insights |
| Notification Service | 4008 | HTTP/HTTPS | Push notifications |
| PostgreSQL | 5432 | TCP | Database |
| Redis | 6379 | TCP | Cache |
| Kafka | 9092 | TCP | Message broker |
| WebRTC Media | 10000-10100 | UDP | Media streaming |
| WebRTC RTC | 40000-49999 | UDP | Peer connections |

---

## Third-Party Services (Required)

### 1. Supabase (Database)
- **URL**: https://supabase.com
- **Plan**: Free tier for testing, Pro ($25/mo) for production
- **What you get**: Managed PostgreSQL, Auth, Storage
- **Setup time**: 5 minutes

### 2. Clerk (Authentication)
- **URL**: https://clerk.com
- **Plan**: Free tier (10k MAU), Pro ($25/mo) for production
- **What you get**: User management, SSO, JWT tokens
- **Setup time**: 10 minutes

### 3. Upstash Redis (Cache)
- **URL**: https://upstash.com
- **Plan**: Free tier (10k commands/day), Pay-as-you-go for production
- **What you get**: Managed Redis with REST API
- **Setup time**: 5 minutes

### 4. Upstash Kafka (Event Streaming)
- **URL**: https://upstash.com/kafka
- **Plan**: Free tier (10k messages/day)
- **What you get**: Managed Kafka cluster
- **Setup time**: 5 minutes

### 5. Stripe (International Payments)
- **URL**: https://stripe.com
- **Plan**: Pay per transaction (2.9% + 30¢)
- **What you get**: Payment processing, webhooks, dashboard
- **Setup time**: 30 minutes

### 6. JazzCash (Pakistan Payments)
- **URL**: https://www.jazzcash.com.pk/business
- **Plan**: Merchant account required
- **What you get**: Local Pakistani payment method
- **Setup time**: 3-5 business days

### 7. OpenAI (AI Commentary)
- **URL**: https://platform.openai.com
- **Plan**: Pay per usage (~$0.002 per 1K tokens)
- **What you get**: GPT-4 for commentary generation
- **Setup time**: 5 minutes

### 8. Sentry (Error Tracking)
- **URL**: https://sentry.io
- **Plan**: Free tier (5k errors/month), Team ($26/mo)
- **What you get**: Error monitoring, performance tracking
- **Setup time**: 10 minutes

### 9. Firebase (Push Notifications)
- **URL**: https://firebase.google.com
- **Plan**: Free tier (up to 1M notifications/month)
- **What you get**: FCM for mobile/web push
- **Setup time**: 15 minutes

---

## Third-Party Services (Optional)

| Service | Purpose | Cost |
|---------|---------|------|
| **Cloudflare** | CDN, DDoS protection | Free tier available |
| **AWS S3** | File storage (if not using Supabase) | Pay per GB |
| **Twilio** | SMS notifications | Pay per SMS |
| **SendGrid** | Transactional emails | Free tier available |
| **ClickHouse Cloud** | Analytics database | Free trial, then pay per usage |
| **Mediasoup VPS** | WebRTC streaming server | $20-50/month VPS |

---

## DNS Requirements

For production deployment, configure these DNS records:

| Record Type | Name | Value | Purpose |
|-------------|------|-------|---------|
| A | @ | Server IP | Root domain |
| A | www | Server IP | WWW redirect |
| A | app | Server IP | Web app |
| A | admin | Server IP | Admin panel |
| A | api | Server IP | API gateway |
| A | ws | Server IP | WebSocket server |
| CNAME | assets | cdn.provider.com | CDN |

---

## SSL/TLS Certificate Requirements

All production endpoints must use HTTPS:

| Domain | Certificate Type |
|--------|------------------|
| yourdomain.com | Let's Encrypt (free) or Commercial |
| app.yourdomain.com | Let's Encrypt (free) or Commercial |
| admin.yourdomain.com | Let's Encrypt (free) or Commercial |
| api.yourdomain.com | Let's Encrypt (free) or Commercial |

---

## Environment Variables Checklist

### Required for Production Launch

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` (Supabase connection string)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- [ ] `CLERK_SECRET_KEY`
- [ ] `SUPER_ADMIN_EMAIL`
- [ ] `REDIS_URL` or `UPSTASH_REDIS_REST_URL`
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `NEXT_PUBLIC_API_URL`

### Required for Payments

- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_PUBLISHABLE_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `JAZZCASH_MERCHANT_ID` (for Pakistan)
- [ ] `JAZZCASH_PASSWORD`
- [ ] `JAZZCASH_HASH_KEY`

### Required for AI Commentary

- [ ] `OPENAI_API_KEY`

### Required for Notifications

- [ ] `FIREBASE_SERVICE_ACCOUNT`
- [ ] `SMTP_HOST`
- [ ] `SMTP_USER`
- [ ] `SMTP_PASS`

### Required for Live Streaming

- [ ] `MEDIASOUP_LISTEN_IP`
- [ ] `MEDIASOUP_ANNOUNCED_IP` (your server public IP)

### Recommended for Monitoring

- [ ] `SENTRY_DSN`
- [ ] `KAFKA_BROKERS`

---

## Cost Estimates (Monthly USD)

### Minimum Viable Product (Free Tiers Only)

| Service | Cost |
|---------|------|
| Supabase (Free) | $0 |
| Clerk (Free - 10k MAU) | $0 |
| Upstash Redis (Free) | $0 |
| Upstash Kafka (Free) | $0 |
| OpenAI (Usage based) | ~$5-20 |
| Sentry (Free) | $0 |
| Firebase (Free) | $0 |
| VPS (1 server) | $20-40 |
| **Total** | **$25-60/month** |

### Production Scale (10k+ users)

| Service | Cost |
|---------|------|
| Supabase Pro | $25 |
| Clerk Pro | $25 |
| Upstash Redis (Pay-as-you-go) | $10-30 |
| Upstash Kafka (Pay-as-you-go) | $10-20 |
| OpenAI | $50-200 |
| Stripe | 2.9% + 30¢ per transaction |
| Sentry Team | $26 |
| Firebase | $0-25 |
| VPS (2-3 servers) | $60-120 |
| Cloudflare Pro | $20 |
| **Total** | **$216-491/month + transaction fees** |

---

## Pre-Deployment Checklist

### Security

- [ ] All secrets stored securely (not in git)
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] CORS origins properly set
- [ ] Rate limiting enabled
- [ ] Database RLS policies active
- [ ] API keys rotated for production

### Performance

- [ ] CDN configured for static assets
- [ ] Database indexes created
- [ ] Redis caching enabled
- [ ] Load balancer configured (if needed)
- [ ] WebSocket scaling tested

### Monitoring

- [ ] Sentry error tracking configured
- [ ] Health check endpoints active
- [ ] Log aggregation setup
- [ ] Database backups scheduled
- [ ] Uptime monitoring enabled

### Legal/Compliance

- [ ] Privacy policy created
- [ ] Terms of service created
- [ ] GDPR compliance (if serving EU)
- [ ] Cookie consent banner
- [ ] Age verification (if required)

---

## Testing Requirements

### Before Production Launch

1. **Load Testing**
   - Simulate 1000+ concurrent users
   - Test WebSocket connections
   - Test scoring API under load

2. **Payment Testing**
   - Test Stripe in test mode
   - Test JazzCash in sandbox
   - Verify webhooks work

3. **Security Testing**
   - Run penetration tests
   - Check for SQL injection
   - Verify RLS policies

4. **Integration Testing**
   - End-to-end match scoring flow
   - Commentary generation
   - Push notifications
   - Real-time updates

---

## Support & Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Too many connections" | Use Supabase connection pooling |
| WebSocket fails | Check firewall, ports 4001, 10000-10100 |
| AI commentary slow | Check OpenAI rate limits |
| Emails not sending | Verify SMTP settings, check spam folder |
| Payments failing | Check webhook endpoints, SSL certificate |

### Support Resources

- **Documentation**: `/docs` folder in repo
- **Supabase Docs**: https://supabase.com/docs
- **Clerk Docs**: https://clerk.com/docs
- **Stripe Docs**: https://stripe.com/docs
- **OpenAI Docs**: https://platform.openai.com/docs

---

## Quick Start Commands

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.development .env.local
# Edit .env.local with your values

# Run database migrations
pnpm --filter @mtk/database db:migrate

# Start development
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Start production services
docker-compose -f docker-compose.prod.yml up -d
```

---

## Contact & Support

For production deployment support:

- **Email**: kaash0542@gmail.com
- **GitHub Issues**: https://github.com/Kaashmalik/mtk-ssl2026/issues
