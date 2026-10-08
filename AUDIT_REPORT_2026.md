# SSL Platform — Full-Stack Audit & Recommended Plan

**Date:** 2026-06-20
**Scope:** Whole monorepo (`apps/`, `services/`, `packages/`, `supabase/`, `infrastructure/`)
**Reviewer:** Senior full-stack SaaS engineering review

---

## 1. Executive Summary

Shakir Super League (SSL) is a **multi-tenant, white-label cricket league
management SaaS** built as a pnpm + Turborepo monorepo. The scope is ambitious
and broadly well-structured at the repo level, but there is a **mismatch
between the as-built architecture and the documented/RLS architecture**, and
several **cross-cutting gaps** that block a confident "production-ready" claim.

**Codebase size:** ~42,800 TS/TSX LOC across `apps/` + `services/` + `packages/`
(excluding `node_modules`, `dist`, `.next`).

| Area | Status |
|---|---|
| Monorepo tooling (pnpm + Turbo) | ✅ Solid |
| App stack currency (Next 15, React 19, Drizzle) | ✅ Modern |
| Multi-tenant isolation — **RLS** | ⚠️ **Architectural gap (see §3.1)** |
| Multi-tenant isolation — **app-layer** | 🟡 Partial, manual, error-prone |
| Microservices (`services/*`) | ⚠️ Real code, but not actually consumed by apps |
| Auth (Clerk + Supabase Auth confusion) | ⚠️ Dual systems, unclear boundary |
| Tests | ❌ Near zero (4 files total) |
| CI/CD | 🟡 Lint/type only; no real gates, no security scan |
| Observability (Sentry) | 🟡 Wired but skipped in dev |
| White-label / SSL / DNS automation | ❌ Placeholders (per IMPLEMENTATION_NOTES.md) |
| Secrets hygiene | ✅ Only `.env.example` tracked |

---

## 2. What Exists (Architecture Map)

### 2.1 Apps (`apps/`)

| App | Port | Stack | Role |
|---|---|---|---|
| `web` | 3001 | Next 15 (App Router) + Clerk + Drizzle + React Query + Tailwind v4 | Tenant dashboard (org admin: leagues, tournaments, teams, players, matches, live scoring, white-label) |
| `admin` | 3002 | Next 15 + Clerk + Drizzle + `@supabase/supabase-js` (service role) | Super-admin platform console (tenants, revenue, system health, feature flags, impersonation) |
| `marketing` | 3003 | Next 15 + Drizzle | Public marketing site + waitlist |
| `mobile` | — | Expo 54 / React Native 0.81 + Supabase JS + Zustand + i18next | Fan-facing mobile app (live scores, push, offline sync) |

### 2.2 Services (`services/`) — NestJS microservices

| Service | LOC | Real? | Notes |
|---|---|---|---|
| `api` | ~2,648 | ✅ Most mature; has tests, WebSocket, SSL/white-label routes | The actual "main" backend |
| `scoring-service` | ~1,085 | ✅ Real | Ball-by-ball scoring |
| `notification-service` | ~632 | ✅ Real | |
| `payment-service` | ~634 | ✅ Real (Stripe provider) | |
| `tournament-service` | ~646 | ✅ Real | |
| `streaming-service` | ~434 | ✅ Real | |
| `api-gateway` | ~641 | ✅ Real (NestJS proxy + Redis + auth middleware + gRPC proto) | |
| `ai-commentary-service` | ~557 | ✅ Real | |
| `analytics-service` | ~351 | ✅ Real (ClickHouse target) | |
| `auth-service` | ~287 | ✅ Real | |
| `edge-cache-service` | **0** | ❌ **Empty stub** (only eslint config) | |

> **Key finding:** the apps (`web`/`admin`) currently talk **directly to
> Postgres/Supabase** via Drizzle, NOT through the microservices or the
> api-gateway. The 10 microservices are real but **not yet in the request
> path** of the Next.js apps. They are effectively a parallel backend.

### 2.3 Database

- **17 migrations** (~2,738 LOC SQL) in `supabase/migrations/`
- **Drizzle schema** in `packages/database/src/schema/` (~1,516 LOC, 30+ tables)
- Core entities: tenants, tenant-branding, users, tournaments, teams, players,
  venues, matches, match-innings, match-balls, scorecards, scoring-events,
  subscriptions, announcements, audit-logs, feature-flags, system-health,
  commission-rates, white-label-requests, dns-verifications, ssl-certificates,
  email-domain-verifications, fantasy-leagues, league-registrations, waitlist.

---

## 3. Critical Findings (fix before scaling)

### 🔴 3.1 RLS is dead code on the main app path — tenant isolation relies entirely on app-layer filtering

**Evidence:**
- `packages/database/src/client.ts:36-46` — the Drizzle `db` connects to
  Postgres via a plain connection string
  (`postgresql://ssl:ssl_dev_password@localhost:5432/ssl_dev`).
- All RLS policies in `014_unify_rls_strategy.sql` predicate on
  `current_tenant_id()` (migration `001:50`) and `is_super_admin()`
  (migration `001:89`).
- `current_tenant_id()` reads from `auth.uid()` / `auth.jwt()` — which are
  **only populated by Supabase Auth + the Supabase data-API**, NOT by a raw
  Drizzle/postgres-js connection.
- The Next.js apps authenticate via **Clerk**, and server actions use the
  Drizzle `db` directly (`apps/web/src/app/actions/tournaments.ts:4`, etc.).
- **No code anywhere** sets `app.tenant_id`, calls `set_config`, or injects a
  tenant claim into the DB session (`grep` for `set local|set_config|set_role`
  returns nothing).

**Consequence:** RLS policies never evaluate on the app's queries. Tenant
isolation is enforced **only** by hand-written `where(eq(...tenantId...))`
clauses in each server action. A single forgotten filter = a cross-tenant data
leak. This is the single biggest risk in the product.

**Two viable paths (pick one — see §6 Plan, item A):**
1. **Embrace app-layer isolation** (current de-facto design): formalize it —
   centralize all queries behind a `tenantScoped(tenantId)` repository layer,
   add an automated test suite that scans for unscoped queries, and treat the
   SQL RLS as defense-in-depth only.
2. **Make RLS actually fire** by routing app writes through Supabase's
   data-API with per-request JWTs carrying `tenant_id`/`role` claims mapped
   from Clerk (via Clerk → Supabase JWT template), or by setting the Postgres
   role/`set_config` per request.

### 🔴 3.2 Dual auth systems with no clear boundary

- `apps/web` & `apps/admin` → **Clerk** (`@clerk/nextjs`).
- `apps/mobile` → **Supabase Auth** (`@supabase/supabase-js` in
  `apps/mobile/src/lib/supabase.ts`).
- `apps/admin` uses **both**: Clerk for identity + Supabase service-role key
  for data (`apps/admin/src/lib/admin-auth.ts:7`, `supabase-server.ts:11`).

This means mobile users (Supabase Auth) and web users (Clerk) have **different
identity systems** that must be reconciled in the `users` table
(`clerkId` vs Supabase `auth.uid`). This is a long-term maintenance and
security hazard.

### 🔴 3.3 Insecure impersonation token

`apps/admin/src/app/api/impersonate/route.ts:48` returns
```
impersonationToken: `impersonate_${targetUserId}_${Date.now()}`
```
A timestamp + id is **trivially forgeable**. Any client that trusts this token
for session elevation is vulnerable. The file's own TODO admits this. Must be
replaced with a signed, short-lived, single-use, audited token.

### 🟡 3.4 Middleware tenant detection is heuristic & fragile

`apps/web/src/middleware.ts:19-29` splits the host on `.` and takes `[0]` as
the tenant slug. On `localhost:3001` and shared domains this misfires. It also
only sets an `x-tenant-slug` header — actual tenant resolution is re-done via
a **DB query** in `apps/web/src/lib/tenant.ts` on every request (no cache).
`IMPLEMENTATION_NOTES.md` already flags that middleware DB calls are not
Edge-ideal.

### 🟡 3.5 Rate limiter is in-process (single-instance only)

`apps/web/src/middleware.ts:46` calls a local `rateLimit()` — fine for one
server, but under multi-instance deploy (Vercel/K8s) each instance keeps its
own counter, so effective limits are multiplied by instance count. Needs
Redis-backed limiter (you already ship Redis in `docker-compose.prod.yml`).

### 🟡 3.6 White-label / SSL / DNS automation is placeholder

Per `IMPLEMENTATION_NOTES.md`: DNS lookups, ACME client, DKIM generation, and
cert storage are all stubs. The whole white-label enterprise pitch depends on
these. This is the gap between "demo-able" and "sellable".

---

## 4. Other Findings (quality / production-readiness)

| # | Area | Finding |
|---|---|---|
| 4.1 | Tests | **4 test files in the entire repo** (`apps/web/src/__tests__/*`). Services that have `jest.config.ts` (api, scoring, tournament) — verify they actually have specs. No e2e/Playwright run config despite `test:e2e` script. |
| 4.2 | CI gates | `.github/workflows/ci-cd.yaml` runs lint + type-check + build + deploy, but **no security scanning** (no CodeQL, no `pnpm audit`, no secret scan), **no required status checks**, and `test` job depends on `lint` with no enforcement that tests pass. |
| 4.3 | Sentry | `apps/web/instrumentation.ts` init is **skipped entirely outside production** — so dev/staging errors are invisible. |
| 4.4 | Config drift | Both `.env`, `.env.local`, `.env.production`, `.env.development` exist locally (correctly gitignored), but `.env.example` is the only contract — risk of undocumented required vars. |
| 4.5 | `edge-cache-service` | Empty directory (only eslint config). Either implement or remove from `docker-compose.prod.yml`. |
| 4.6 | Duplicate docs | `DEPLOY.md` + `DEPLOYMENT.md`, `ENV_SETUP.md` + `ENV_SETUP_GUIDE.md`, `Readme.md` + `README-SETUP.md`, `PHASE_1_AUDIT.md` + `PHASE_2_AUDIT.md` + `CODEBASE_REVIEW_2026.md`. Consolidate. |
| 4.7 | Two `api`s | `services/api` (NestJS, ~2,648 LOC) and `services/api-gateway`. Naming is confusing and they overlap. |
| 4.8 | `bash.exe.stackdump` + `expo-output.log` + `dist/` at repo root | Build artifacts / crash dumps committed-ish; clean up. |
| 4.9 | Admin authz | `verifySuperAdmin()` (`apps/admin/src/lib/admin-auth.ts`) allows super-admin via **either** DB role **or** env `SUPER_ADMIN_EMAIL` match. Email-match bypass is convenient but a config footgun — prefer role-only. |
| 4.10 | Public route surface | `apps/web/src/middleware.ts:7-16` exposes `/matches/(.*)`, `/tournaments/(.*)`, `/teams/(.*)`, `/players/(.*)`, and `/api/ssl(.*)` as public. Verify each of those endpoints/tables never returns sensitive (PII/payment) data. |

---

## 5. Strengths to Preserve

- **Modern, consistent stack** — Next 15, React 19, Drizzle, Tailwind v4, Zod.
- **Sensible package boundaries** — `@mtk/database`, `@mtk/ui`, `@mtk/config`.
- **Defense-in-depth intent** — RLS exists even if not currently wired; RBAC
  layer (`apps/web/src/lib/rbac.ts`, 237 LOC) + `withAuth` action guard is a
  good pattern.
- **Per-service Dockerfiles** + a full `docker-compose.prod.yml` (Postgres,
  Redis, ClickHouse, Kafka, Zookeeper, 10 services, nginx).
- **Workspace hygiene** — only `.env.example` is tracked; no secrets in source
  (`grep` for `eyJ`/`sk_live` in tracked source returned clean).
- **Type-safe data layer** — Drizzle schema is comprehensive and matches
  migrations.

---

## 6. Recommended Plan (prioritized)

> Sequenced so each phase is independently shippable. Effort is relative
> (S≈1d, M≈3–5d, L≈1–2wk).

### Phase 0 — Stabilize & document the truth (Effort: S, Risk: low)
**Goal:** stop accumulating decisions on false assumptions.
1. **Pick the tenant-isolation strategy (decision A from §3.1)** and write an
   ADR in `docs/adr/`. Either "RLS-primary" or "app-layer-primary" — but
   choose one explicitly.
2. **Pick the auth strategy (decision B from §3.2):** Clerk-everywhere (and
   drop mobile Supabase Auth) **or** document the dual-identity contract.
3. Consolidate duplicate docs (§4.6); delete `bash.exe.stackdump`,
   `expo-output.log`, stray `dist/`.
4. Delete or implement `edge-cache-service` (§4.5).

### Phase 1 — Close the security holes (Effort: M, Risk: high if skipped)
1. **Fix impersonation** (§3.3): signed JWT, ≤5 min TTL, single-use, written to
   `audit_logs`, revocable.
2. **Centralize tenant scoping** (regardless of decision A): introduce a
   `packages/database/src/repositories/*` layer where **every** query takes
   `tenantId` and there is no path to call `db.select()` without it. Migrate
   server actions one module at a time.
3. **Add a "no unscoped query" lint/test** — AST test that fails CI if
   `db.select/update/delete` is called outside the repository layer.
4. **Redis-backed rate limiter** (§3.5) shared across instances.
5. **CI security gates** (§4.2): add `pnpm audit`, `actions/secret-scan` /
   `gitleaks`, CodeQL, and make `lint+type+test` **required** on PRs to `main`.

### Phase 2 — Make isolation verifiable (Effort: M, Risk: medium)
1. **Tenant-isolation test suite** (highest-value tests to write): for each
   entity, seed two tenants, act as tenant A, assert tenant B's rows never
   appear. This single suite catches the entire class of §3.1 bugs.
2. Wire Sentry in **all** non-test envs (§4.3); add a `/health` and
   `/ready` check per app; add structured logging (pino) in services.
3. Stand up **Playwright e2e** for the 3 critical flows: tenant signup →
   tournament create → live scoring; white-label custom-domain; fan mobile
   live-view.

### Phase 3 — Finish the white-label / enterprise path (Effort: L)
This is the monetizable differentiator and it's all stubbed today.
1. Real **DNS verification** (Cloudflare/Route53 provider abstraction).
2. Real **ACME SSL issuance** (`acme-client`), renewal cron, encrypted cert
   storage (S3/KMS), staging→prod rollout.
3. Real **DKIM/SPF/DMARC** generation + email-domain verification.
4. End-to-end test: register domain → verify → issue cert → serve branded
   tenant site.

### Phase 4 — Unify the backend (Effort: L, optional/strategic)
Decide whether the NestJS microservices (`services/*`) are the future backend
or vestigial. Today the Next.js apps bypass them entirely.
- **If yes:** migrate `web`/`admin` server actions to call the `api-gateway`
  (it already has auth middleware + Redis + gRPC proto), gain a single
  enforced authz boundary, and let the gateway set the tenant context that
  makes RLS fire (this is how decision A "RLS-primary" becomes achievable).
- **If no:** archive `services/*` to a branch, simplify `docker-compose`, and
  stop maintaining two backends. **Don't keep both half-alive.**

### Phase 5 — SaaS operational maturity (Effort: ongoing)
1. **Backups & DR** for Postgres + ClickHouse; tested restore runbook.
2. **Usage/billing telemetry** (you have `subscriptions` + `commission-rates`
   tables — wire Stripe webhooks end-to-end with idempotency + retry).
3. **Feature-flagged rollouts** (table exists) — actually gate risky changes.
4. **Audit log coverage** — every admin mutation writes to `audit_logs`
   (impersonation, tenant config changes, commission edits, white-label
   approvals).
5. **On-call basics**: runbook, alerting on `/health` + error-rate, dashboards.

---

## 7. Suggested 4-Week Sprint Breakdown

| Week | Focus | Deliverable |
|---|---|---|
| 1 | Phase 0 + Phase 1.1–1.3 | ADRs written; impersonation fixed; repository layer scaffolded for `tournaments` + `teams` + `players` as the template; CI security gates on. |
| 2 | Phase 1.4–1.5 + Phase 2.1 | Redis rate-limit; tenant-isolation test suite green for core entities. |
| 3 | Phase 2.2–2.3 + Phase 3.1–3.2 | Sentry everywhere; e2e for signup→score flow; real DNS + ACME on staging. |
| 4 | Phase 3.3–3.4 + Phase 4 decision | Email verification live; backend-unification decision ADR + first migration (or archival). |

---

## 8. TL;DR for the owner

You have a **genuinely impressive, broad codebase** with modern tooling and a
coherent multi-tenant data model. The blockers to calling it "production-grade
SaaS" are narrow and fixable:

1. **Tenant isolation is app-layer-only and unverified** — make it a real
   boundary with a test suite (§3.1, Phase 1–2). **This is #1.**
2. **Pick one auth system and one backend path** — Clerk+Drizzle-direct vs.
   microservices+gateway (§3.2, Phase 4).
3. **Close the impersonation hole and add CI security gates** (§3.3, §4.2).
4. **Finish the white-label automation** — it's the whole enterprise pitch and
   it's stubbed (§3.6, Phase 3).

Do those four and the platform goes from "ambitious prototype" to "defensible
multi-tenant SaaS."
