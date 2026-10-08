# SSL Environment Variables Setup Guide

This guide walks you through obtaining all required environment variables for production deployment.

## Quick Setup Steps

```powershell
# 1. Copy example file
cp .env.example .env.prod

# 2. Edit with your values (use any editor)
notepad .env.prod

# 3. Deploy
.\deploy.sh
```

---

## 🔐 Required Credentials (Get These First)

### 1. Clerk Authentication (SSO/Auth)
**Required for:** User login, signup, sessions

**Steps:**
1. Go to https://dashboard.clerk.com
2. Create new application
3. Choose "Next.js" as framework
4. Copy:
   - `CLERK_SECRET_KEY` → "API Keys" tab → "Secret key"
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → "API Keys" tab → "Publishable key"

**Cost:** Free tier: 10,000 MAU

---

### 2. PostgreSQL Database
**Required for:** All app data (users, matches, teams)

---

#### Option A - Supabase (Recommended ⭐)
Best choice for SSL - includes Postgres + Auth + Storage + Realtime

**Steps:**
1. Go to https://supabase.com and sign up
2. Create new project (choose region closest to users - "East US" or "Mumbai")
3. Wait for database to be ready (~2 minutes)
4. Get your credentials:

**Project URL & Keys:**
- Go to Project Settings → API
- Copy `SUPABASE_URL` (e.g., `https://xxxxxxx.supabase.co`)
- Copy `SUPABASE_SERVICE_ROLE_KEY` (use "service_role" key for backend)
- Copy `SUPABASE_ANON_KEY` (use "anon/public" key for frontend)

**Database Connection String:**
- Go to Project Settings → Database → Connection string
- Select "URI" format
- Copy connection string for `DATABASE_URL`
- **Use Session pooler** for backend services
- **Format:** `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxx.supabase.co:5432/postgres`

**Free Tier Limits:**
- 500MB database
- 2GB bandwidth
- Unlimited API requests

**To disable self-hosted Postgres when using Supabase:**
```bash
# In docker-compose.prod.yml, comment out the postgres service
# Or set up external Supabase connection only
```

---

#### Option B - Self-hosted (Docker)
```env
POSTGRES_USER=ssl
POSTGRES_PASSWORD=$(openssl rand -base64 32)
POSTGRES_DB=ssl_prod
DATABASE_URL=postgresql://ssl:password@postgres:5432/ssl_prod
```

---

#### Option C - Neon
- https://neon.tech (Free tier: 500MB, serverless Postgres)

#### Option D - AWS RDS
- https://aws.amazon.com/rds (Best for enterprise)

---

### 3. Redis Cache
**Required for:** Sessions, real-time data, rate limiting

**Option A - Self-hosted (Docker):**
```env
REDIS_URL=redis://redis:6379
```

**Option B - Managed:**
- **Redis Cloud:** https://redis.com/redis-enterprise-cloud (Free: 30MB)
- **Upstash:** https://upstash.com (Serverless Redis, free tier)

---

---

## 💳 Payment Providers (Required for paid features)

### 4. Stripe (International Cards)
**Required for:** Credit/debit card payments

**Steps:**
1. Go to https://dashboard.stripe.com/register
2. Complete account setup
3. Go to "Developers" → "API keys"
4. Copy:
   - `STRIPE_SECRET_KEY` → Secret key (sk_live_...)
   - `STRIPE_WEBHOOK_SECRET` → After creating webhook endpoint

**Webhook endpoint to create:**
```
https://api.yourdomain.com/payments/webhook
```

**Cost:** 2.9% + 30¢ per transaction

---

### 5. JazzCash (Pakistan Local)
**Required for:** Pakistani users paying via JazzCash/Easypaisa

**Steps:**
1. Contact JazzCash Business: business@jazzcash.com.pk
2. Request "Merchant Account"
3. They will provide:
   - `JAZZCASH_MERCHANT_ID`
   - `JAZZCASH_PASSWORD`
   - Integration documentation

**Cost:** Contact for pricing

---

---

## 🤖 AI & Notifications (Optional but Recommended)

### 6. OpenAI (AI Commentary)
**Required for:** Automatic match commentary generation

**Steps:**
1. Go to https://platform.openai.com/signup
2. Add payment method
3. Go to "API Keys" → "Create new secret key"
4. Copy:
   - `OPENAI_API_KEY` (sk-...)

**Cost:** ~$0.002 per 1K tokens (~$0.01-0.05 per commentary)

---

### 7. Firebase (Push Notifications)
**Required for:** Mobile push notifications

**Steps:**
1. Go to https://console.firebase.google.com
2. Create project
3. Go to ⚙️ → Project Settings → Service Accounts
4. Click "Generate new private key"
5. Download JSON file
6. Copy entire JSON content as `FIREBASE_SERVICE_ACCOUNT`

**Cost:** Free tier: 1M notifications/month

---

### 8. SMTP Email
**Required for:** Transactional emails (receipts, notifications)

**Option A - Gmail (Easiest for testing):**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password  # See below
```

**Get Gmail App Password:**
1. Go to https://myaccount.google.com/security
2. Enable 2-Factor Authentication
3. Go to "App passwords" → Select "Mail" + "Other"
4. Generate and copy password

**Option B - SendGrid (Production):**
- https://sendgrid.com (Free: 100 emails/day)

**Option C - AWS SES:**
- https://aws.amazon.com/ses/ (Cheapest at scale)

---

### 9. Twilio (SMS)
**Required for:** SMS notifications to players/organizers

**Steps:**
1. Go to https://www.twilio.com/try-twilio
2. Sign up (get free trial credits)
3. Get from Console Dashboard:
   - `TWILIO_SID` (Account SID)
   - `TWILIO_TOKEN` (Auth Token)
   - `TWILIO_PHONE` (Buy a phone number)

**Cost:** ~$0.0075 per SMS (US), varies by country

---

---

## 📊 Monitoring & Analytics

### 10. Sentry (Error Tracking)
**Required for:** Production error monitoring

**Steps:**
1. Go to https://sentry.io/signup/
2. Create organization (e.g., "shakir-super-league")
3. Create project "ssl-web"
4. Copy DSN:
   - Go to Project Settings → Client Keys (DSN)
   - Copy DSN for `SENTRY_DSN`

**Cost:** Free tier: 5,000 errors/month

---

### 11. ClickHouse (Analytics)
**Required for:** Match statistics, leaderboards

**Option A - Self-hosted (Docker):**
```env
CLICKHOUSE_USER=ssl
CLICKHOUSE_PASSWORD=$(openssl rand -base64 32)
```

**Option B - ClickHouse Cloud:**
- https://clickhouse.cloud (Free trial: $300 credits)

---

---

## 🎥 WebRTC Streaming (Optional)

### 12. Mediasoup (Live Streaming)
**Required for:** Live match streaming

**Setup:**
```env
# Your server's public IP address
MEDIASOUP_ANNOUNCED_IP=203.0.113.1
# Or domain: MEDIASOUP_ANNOUNCED_IP=stream.yourdomain.com
```

**Firewall Requirements:**
- Open UDP ports: 10000-10100 (mediasoup)
- Open UDP ports: 40000-49999 (WebRTC)

---

---

## ✅ Final Checklist

Before deploying, verify you have:

### Minimum Viable (MVP):
- [ ] `POSTGRES_PASSWORD` - Database password
- [ ] `CLERK_SECRET_KEY` - Authentication
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Auth (public)
- [ ] `STRIPE_SECRET_KEY` - Payments (or comment out payment service)

### Full Production:
- [ ] All MVP items
- [ ] `CLICKHOUSE_PASSWORD` - Analytics
- [ ] `OPENAI_API_KEY` - AI commentary
- [ ] `FIREBASE_SERVICE_ACCOUNT` - Push notifications
- [ ] `SMTP_PASS` - Email
- [ ] `SENTRY_DSN` - Error tracking
- [ ] `MEDIASOUP_ANNOUNCED_IP` - Streaming

---

## 🔒 Security Best Practices

1. **Never commit `.env.prod`** to git
   ```bash
   # Already in .gitignore, but verify:
   git check-ignore -v .env.prod
   ```

2. **Generate strong passwords:**
   ```powershell
   # PowerShell
   -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
   
   # Or use OpenSSL
   openssl rand -base64 32
   ```

3. **Rotate secrets regularly** (every 90 days)

4. **Use different credentials** for staging vs production

---

## 🆘 Troubleshooting

### "Invalid API key" errors:
- Check for extra spaces
- Verify live vs test keys (use `sk_live_` not `sk_test_`)

### "Database connection failed":
- Check firewall rules
- Verify connection string format
- Test: `psql $DATABASE_URL`

### "Redis connection timeout":
- Verify Redis is running: `docker ps | grep redis`
- Check REDIS_URL format

### "Firebase auth error":
- Ensure service account JSON is valid (no newlines)
- Check project_id matches your Firebase project

---

## 📞 Support Resources

| Service | Support Link |
|---------|-------------|
| Clerk | https://clerk.com/support |
| Stripe | https://support.stripe.com |
| OpenAI | https://help.openai.com |
| Firebase | https://firebase.google.com/support |
| Sentry | https://sentry.io/contact/support/ |
| Twilio | https://support.twilio.com |
