# Supabase Setup for SSL (Shakir Super League)

This guide shows how to configure Supabase as your database for the SSL application.

## Why Supabase?

- ✅ **Managed Postgres** - No database maintenance
- ✅ **Connection Pooling** - Handles 10,000+ concurrent users
- ✅ **Free Tier** - 500MB database, 2GB bandwidth
- ✅ **Auth Alternative** - Can replace Clerk if desired
- ✅ **Storage** - For match photos, player images
- ✅ **Realtime** - Built-in WebSocket subscriptions

---

## Quick Setup

### Step 1: Create Supabase Project

```bash
# 1. Sign up at https://supabase.com
# 2. Click "New Project"
# 3. Choose organization
# 4. Set project name: "ssl-production" (or any name)
# 5. Choose database password (save this!)
# 6. Select region (Mumbai for Pakistan, East US for global)
# 7. Click "Create new project"
```

**Wait ~2 minutes for database to be ready**

---

### Step 2: Get Your Credentials

**From Project Settings → API:**

```env
SUPABASE_URL=https://xxxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...      # public
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1...   # secret - backend only!
```

**From Project Settings → Database → Connection string:**

```env
# Use "Session pooler" for backend services
DATABASE_URL=postgresql://postgres.xxxxxxxxxxxxxx:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

---

### Step 3: Configure Your App

**Edit `.env.prod`:**

```env
# Comment out or remove local Postgres
# POSTGRES_USER=ssl
# POSTGRES_PASSWORD=...

# Add Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-xxxxx.pooler.supabase.com:5432/postgres
```

---

### Step 4: Run Migrations

```powershell
# Install Supabase CLI (if not already installed)
scoop install supabase

# Link to your project
cd d:\MalikTech\mtk-ssl
supabase link --project-ref your-project-ref

# Push migrations
supabase db push

# Or use Drizzle (if configured)
pnpm --filter @mtk/database migrate
```

---

### Step 5: Deploy Without Local Postgres

**Option A: Edit docker-compose.prod.yml**

Comment out the postgres service:

```yaml
# postgres:
#   image: postgres:17-alpine
#   container_name: ssl-prod-postgres
#   ...
```

And remove postgres from service `depends_on` sections.

**Option B: Keep Postgres for local development, use Supabase for production**

Just set `DATABASE_URL` to Supabase in `.env.prod` - the app will connect to Supabase instead of local Postgres.

---

## Database Migrations

### Using Supabase CLI (Recommended)

```bash
# Create new migration
supabase migration new add_player_stats

# Edit migration file in supabase/migrations/

# Apply to local (if using local supabase)
supabase db reset

# Apply to production
supabase db push
```

### Using Drizzle ORM

```powershell
# Generate migration from schema changes
pnpm --filter @mtk/database db:generate

# Apply to Supabase
pnpm --filter @mtk/database db:migrate
```

---

## Connection Pooling

Supabase provides **PgBouncer** for connection pooling:

| Mode | Use Case | Port |
|------|----------|------|
| **Session** | Long-lived connections (NestJS backend) | 5432 |
| **Transaction** | Serverless/lambda (Next.js API routes) | 6543 |

**For SSL microservices (NestJS):** Use Session mode port 5432

**Connection String Format:**
```
postgresql://postgres.[project-ref]:[password]@aws-0-xxxxx.pooler.supabase.com:5432/postgres
```

---

## Common Issues

### "Too many connections"

Supabase free tier allows 60 concurrent connections. Use connection pooling:

```env
# Add ?pgbouncer=true to enable pooling
DATABASE_URL=postgresql://.../postgres?pgbouncer=true
```

### "SSL/TLS required"

Add SSL mode to connection string:

```env
DATABASE_URL=postgresql://.../postgres?sslmode=require
```

### Migration fails with RLS error

Supabase has strict RLS. Run migrations as `postgres` role (service_role key).

---

## Supabase vs Self-hosted Postgres

| Feature | Supabase | Self-hosted |
|---------|----------|-------------|
| **Setup Time** | 2 minutes | 30+ minutes |
| **Maintenance** | None | You manage backups, updates |
| **Backups** | Automatic (daily) | Manual setup |
| **Scaling** | Click to upgrade | Manual server config |
| **Cost (Start)** | Free | Server cost |
| **Cost (Scale)** | $25-100/month | $20-50/month VPS |
| **Connection Limit** | 60 (free) / 200 (pro) | Unlimited |
| **Bandwidth** | 2GB (free) | Unlimited |

**Recommendation:** Start with Supabase free tier. Migrate to self-hosted only when you exceed 60 concurrent connections or 2GB bandwidth.

---

## Additional Supabase Features

### 1. File Storage (Player Photos, Match Images)

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Upload player photo
const { data, error } = await supabase.storage
  .from('player-photos')
  .upload('player-123.jpg', file)
```

### 2. Real-time Subscriptions (Alternative to Kafka/WebSocket)

```typescript
// Subscribe to score changes
supabase
  .channel('match-scores')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ball_events' }, payload => {
    console.log('New ball:', payload.new)
  })
  .subscribe()
```

### 3. Edge Functions (Serverless API)

```typescript
// Deploy serverless functions
supabase functions deploy calculate-rrr

// Call from frontend
const { data } = await supabase.functions.invoke('calculate-rrr', { body: { matchId: 123 } })
```

---

## Migration from Clerk to Supabase Auth (Optional)

If you want to use Supabase Auth instead of Clerk:

1. **Enable Auth in Supabase:**
   - Go to Authentication → Providers
   - Enable Email, Google, Phone (SMS)

2. **Update env.ts:**
```typescript
SUPABASE_URL: z.string().url()
SUPABASE_SERVICE_ROLE_KEY: z.string()
// Remove CLERK_SECRET_KEY
```

3. **Update frontend:**
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Use Supabase Auth
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})
```

**Note:** This requires significant code changes. Stick with Clerk unless you need deep Supabase integration.

---

## Support

- Supabase Docs: https://supabase.com/docs
- SSL Discord/Community: Ask in #database channel
