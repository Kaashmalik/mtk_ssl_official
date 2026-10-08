# MCP Setup — Supabase + Backend Integration

This guide wires the **Supabase MCP** (and a Postgres MCP) into your editor
so the assistant can read/write your database, run migrations, and inspect
schemas coherently with how the apps already connect (Drizzle → Postgres
via `DATABASE_URL`).

## TL;DR

1. Get a Supabase Personal Access Token: https://supabase.com/dashboard/account/tokens
2. Copy `.mcp.json.example` → `.mcp.json` (gitignored)
3. Paste your token into the `Authorization` header
4. Restart your editor / reload the MCP panel
5. On first connect, pick the `shakir-super-league` project when prompted

---

## Why this matches your project

Your architecture (verified during the audit):

```
apps/web  ─┐
apps/admin ─┼─→ @mtk/database (Drizzle) ─→ DATABASE_URL ─→ Supabase Postgres
apps/marketing ─┘                                              │
                                                              ▲
services/api (NestJS, SSL only) ──────────────────────────────┘
```

- **Drizzle migrations** write to `supabase/migrations/*.sql` (see `packages/database/drizzle.config.ts`)
- **All three apps** + the NestJS service read the same `DATABASE_URL`
- **Clerk** handles auth in the apps; Supabase Auth is NOT in the request path (RLS using `auth.uid()` therefore never fires — this was audit finding #1)

The MCP setup gives the assistant the **same view** the apps have: direct
Postgres access via the same connection string, plus Supabase-specific
tooling (migrations, edge functions, project settings).

---

## Option 1 — Remote Supabase MCP (recommended)

No local install; Supabase hosts the MCP server.

**`.mcp.json`:**

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp",
      "headers": {
        "Authorization": "Bearer sbp_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

**Tools exposed:** `execute_sql`, `list_tables`, `apply_migration`,
`list_edge_functions`, `list_project_urls`, etc.

**First run:** you'll be asked which project to scope to. Pick the one
matching `NEXT_PUBLIC_SUPABASE_URL` in your `.env`.

---

## Option 2 — Local npx Supabase MCP

Use this if you run Supabase locally (`supabase start`) or want offline use.

**`.mcp.json`:**

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "sbp_YOUR_TOKEN_HERE",
        "SUPABASE_PROJECT_REF": "your-project-ref"
      }
    }
  }
}
```

Find `SUPABASE_PROJECT_REF` in the Supabase dashboard URL:
`https://supabase.com/dashboard/project/<THIS_IS_THE_REF>`.

Add `--read-only` to args while testing; remove it for migration runs.

---

## Option 3 — Plain Postgres MCP (Supabase-agnostic)

Matches exactly how `@mtk/database` connects. Useful for raw SQL / Drizzle
cross-check without Supabase-specific features.

**Local dev** (matches `supabase/config.toml` `[db] port = 54322`):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:54322/postgres"
      }
    }
  }
}
```

**Hosted Supabase:**

```json
{
  "DATABASE_URL": "postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
}
```

Use port **6543** (the pooler from your `config.toml [db.pooler] port = 6543`)
for production; port 5432 for direct.

---

## Coherent dev workflow

With the MCP wired, your assistant can do the full DB loop without you
touching a terminal:

```
1. You:        "Add a `notifications_enabled` column to tenants"
2. Assistant:  edits packages/database/src/schema/tenants.ts (Drizzle)
3. Assistant:  runs `pnpm --filter @mtk/database generate`
              → writes supabase/migrations/020_*.sql
4. Assistant:  applies it via MCP `apply_migration` tool
              → schema live in your DB
5. Assistant:  type-checks the apps to confirm @mtk/database picks it up
```

This is identical to the manual flow — just faster.

---

## Booting the whole stack

The Turborepo `dev` script now forwards every env var the apps and the
NestJS service need (DATABASE_URL, REDIS_URL, SENTRY_*, ACME_*, etc.):

```bash
pnpm dev    # boots web (3001), admin (3002), marketing (3003), api (4000)
```

To boot the NestJS service standalone:

```bash
pnpm --filter @mtk/api dev
```

---

## Security checklist

- [ ] `.mcp.json` is gitignored (added in this commit — verify with `git check-ignore .mcp.json`)
- [ ] Token has minimum scope (project-scoped where possible)
- [ ] Use `--read-only` for the Supabase MCP in shared dev environments
- [ ] Rotate the token if it leaks; Supabase tokens are revocable from the dashboard
- [ ] Never paste the token in chat or commit messages

---

## Verifying the MCP works

After setup, ask the assistant:

> "List the tables in the public schema"

You should see: `tenants`, `users`, `tournaments`, `teams`, `players`,
`matches`, `audit_logs`, `impersonation_sessions`, `error_logs`, etc.

Then:

> "Show me the latest migration file"

It should point to `supabase/migrations/019_add_dkim_private_key.sql`.
