# SSL Platform — Deep Full-Stack Audit & Enhancement Plan

**Date:** 2026-06-23
**Scope:** Whole monorepo (`apps/`, `services/`, `packages/`, `supabase/`, `infrastructure/`)
**Method:** Live code review + live Supabase DB queries (via postgres driver)
**Reviewer:** Senior full-stack SaaS engineering review (continuation of `AUDIT_REPORT_2026.md`)

---

## 0. How to read this report

This is a **fresh, verified** audit. The earlier `AUDIT_REPORT_2026.md` (2026-06-20)
flagged 6 critical items. Several have since been fixed in commits `302a31f`,
`a20d269`, `bccd7ce`. I verified each fix against the actual current code **and
against the live production database**, and found **new issues** that are more
urgent than what remains from the old list.

Status legend: ✅ fixed/solid · ⚠️ partial/risky · ❌ broken/missing

---

## 1. What changed since the last audit (verified)

| Prior finding | Status | Evidence |
|---|---|---|
| §3.3 Insecure impersonation token | ✅ **Fixed** | `packages/database/src/auth/impersonation-token.ts` — HMAC-SHA256, 5-min TTL, jti single-use, iss/aud pinning. Admin route (`apps/admin/src/app/api/impersonate/route.ts`) now signs token + writes `impersonation_sessions` ledger + `audit_logs` + self-impersonation guard. |
| §3.5 In-process rate limiter | ✅ **Fixed** | `apps/web/src/lib/rate-limit.ts` — 3-tier: Upstash (Edge) → ioredis (Node) → in-memory. Middleware applies it to all mutations. |
| §3.1 RLS dead code | ⚠️ **Pivoted, not fixed** | Team chose "app-layer-primary" (correct call). Built `TenantScopedRepository` + `AsyncLocalStorage` context + `no-unscoped-queries.test.ts` guard. **But migration is ~30% done** (see §3.1 below). |
| §3.6 White-label/SSL stubbed | ✅ **Fixed** | `services/api/src/ssl/ssl.service.ts` — real ACME (Let's Encrypt), real DNS-01 via `@mtk/dns-provider`, real X.509 expiry parsing, renewal cron. Genuinely production-grade. |
| §4.1 No tests | 🟡 **Improved** | Now 6 unit tests + tenant-isolation + e2e specs exist. Still thin, but the *guard* tests (`no-unscoped-queries`, `tenant-isolation`) are the high-value ones and they exist. |
| §4.5 edge-cache empty | ❌ **Still empty** | `services/edge-cache-service/` has zero source files. |

**Bottom line:** the security and white-label tracks advanced well. The **core
cricket product** did not, and a new **migration-drift** problem appeared.

---

## 2. Executive summary (current state)

| Area | Status | One-liner |
|---|---|---|
| Core feature: live ball-by-ball scoring | ❌ **Broken / not persisted** | Balls live only in browser Zustand + go to a stubbed WS service. **0 rows ever written to `match_balls` in prod DB.** |
| Microservices ↔ apps integration | ❌ **Dead code** | The 10 NestJS services are not in the app request path. Web/admin talk to Postgres directly. |
| Production DB migration drift | ❌ **Diverged** | Repo has 24 migration files; live DB ledger has 13 *different-named* migrations. Newest 11 repo migrations never applied. |
| Tenant isolation (app layer) | ⚠️ **30% migrated** | Repo pattern exists + tested, but 6/9 action files still use raw `db` (allowlisted in the guard). |
| Auth boundary (Clerk vs Supabase) | ❌ **Still dual** | Web/admin = Clerk; mobile = Supabase Auth. Unreconciled. |
| SaaS billing | ⚠️ **Manual only** | Upload-receipt → admin approve. No real gateway in the app path; `payment-service` exists but unused. |
| White-label / SSL automation | ✅ **Real** | ACME + DNS provider are genuinely implemented. |
| Observability | 🟡 **Partial** | Sentry skipped outside prod; pino logging in services is real. |

---

## 3. Critical findings (fix before scaling)

### 🔴 3.1 Live scoring does not persist — the core product is broken end-to-end

This is the single most important finding. The headline feature of a cricket
platform is live ball-by-ball scoring, and **no ball is ever saved to the database.**

**The chain, traced end to end:**

1. `apps/web/src/app/matches/[matchId]/scoring/page.tsx` — scorer taps a ball →
   it goes into the **client-side Zustand store** (`useScoringStore`) only.
   `localStorage` persistence means it survives reload on *the same browser*,
   but not across devices/scorecard rebuilds.
2. `page.tsx:125` calls `emitBall(...)` over WebSocket to `services/api`.
3. `services/api/src/scoring/scoring.gateway.ts:162` calls
   `scoringService.addBall(matchId, ballData)`.
4. `services/api/src/scoring/scoring.service.ts:12-28` — **STUBBED**:
   ```ts
   async addBall(matchId, ballData) {
     this.logger.log(`Adding ball for match ${matchId}`);
     // TODO: Implement database save using Drizzle ORM
     return { id: `ball-${Date.now()}`, ...ballData, matchId, ... };  // fake
   }
   ```
   `removeBall`, `getMatchState`, `getMatchBalls` are likewise TODOs returning
   empty/fake data.

**Verified against prod DB:** `SELECT count(*) FROM match_balls` → **0**.

**Secondary bugs in the same flow:**
- `socket-client.ts:33` connects to namespace **`/scoring`**, but the gateway
  declares `namespace: "/"` (`scoring.gateway.ts:68`). Handshake mismatch — the
  socket would fail to register handlers unless a second gateway mounts `/scoring`.
  No such gateway exists.
- `page.tsx:75` hardcodes `teamId: ""` (should come from match data).
- `page.tsx:167` hardcodes `totalOvers = 20` (ignores match format — a T10/ODI
  match would still show 20).
- `page.tsx:69-95` resets the entire innings state when `matchId` changes — so
  navigating away and back **wipes the scorecard** (only localStorage saves you,
  and only on that device).

**Why `scorecards.ts` is not a workaround:** there *is* a real
`saveScorecard` server action that writes batting/bowling aggregates to the DB,
but it's a post-match manual summary — nothing feeds it from the live scorer,
and it doesn't write `match_balls`.

### 🔴 3.2 Production database migration drift

**Evidence (queried live):**
- Repo `supabase/migrations/`: 24 files named `001_*` … `022_*` + `20260623_*`.
- Live `supabase_migrations.schema_migrations`: **13 rows**, all named
  `2026051403xxxx` — a **completely different** naming/timestamp scheme.
- The newest repo migrations are **not applied**:
  - `20260623_add_user_tenant_roles.sql` → table `user_tenant_roles` **missing** in prod.
  - `022_create_starter_plan_and_payment_tables.sql` → `subscription_plans` **missing**.
- Conversely, the code references both tables (`packages/database/src/schema/user-tenant-roles.ts`,
  the tenant-context membership check), so on a fresh prod deploy the app can
  throw at runtime.

**Root cause:** there are **two parallel migration histories** — likely a Supabase
CLI-managed set (the applied `20260514…` ones) and a hand-written `001-022` set
that was added to the repo but never run against the cloud project. Drizzle's
`drizzle-kit` and Supabase CLI migrations are also not reconciled.

**Risk:** silent schema/code skew. Any deploy that runs the repo migrations could
double-create or fail; any code path hitting the missing tables crashes.

### 🔴 3.3 The 10 microservices are dead code from the apps' perspective

Grepping the entire `apps/` tree for service consumption, the only references are:
- `apps/web/src/middleware.ts` (generic)
- `apps/web/src/app/api/cron/ssl-renewal/route.ts` — calls `API_SERVICE_URL` if set,
  **and no-ops with a warning if it isn't** ("API service not deployed").

No app makes an HTTP call to the scoring/payment/notification/tournament/streaming/
ai-commentary/analytics services. The apps read/write Postgres **directly** via
Drizzle. So:
- `scoring-service` (standalone) — unused.
- `payment-service` (Stripe/JazzCash) — unused; the real billing flow is manual upload.
- `notification-service` — unused; no app sends through it.
- The impressive `api-gateway` with gRPC + Redis + auth middleware — unused.

You are maintaining ~6,000 LOC of NestJS that does nothing in production. Pick one:
**commit to the gateway as the backend** (then `web`/`admin` call it and you get
one authz boundary + RLS-can-fire), **or archive it**. Half-alive is the worst state.

### 🔴 3.4 Dual auth (Clerk vs Supabase) still unresolved

- `apps/web`, `apps/admin` → Clerk (`@clerk/nextjs`).
- `apps/mobile` → Supabase Auth (`apps/mobile/src/lib/supabase.ts`).
- The `users` table keys on `clerkId`; Supabase-auth mobile users have no
  `clerkId`, so tenant membership / RBAC in `tenant-context.ts` can't resolve them.

A mobile user literally cannot be authorized through the same RBAC layer as web
users today. Either move mobile to Clerk (Clerk supports React Native) or build
an explicit identity-reconciliation job. Don't ship both indefinitely.

### 🟡 3.5 SaaS billing has no real payment gateway in the app path

`apps/web/src/app/api/subscriptions/request/route.ts` is the *actual* upgrade flow:
it inserts a `subscription_requests` row with `paymentMethod ∈ {bank_transfer,
jazzcash_manual, easypaisa_manual}` and `paymentProofUrl`, status `pending`,
then waits for **admin manual approval**. There is no Stripe/JazzCash/Easypaisa
automated checkout in the user's path. The `payment-service` with real Stripe is
wired to nothing.

This is fine as a Phase-1 launch decision (manual approval is legitimate), **but:**
- The marketing page advertises "Payment collection" on the Starter plan —
  misleading if it's really "upload a bank slip".
- Plan **prices are duplicated in 3 places**: `plan-limits.ts` (`PLAN_PRICES`),
  `subscriptions/request/route.ts` (`PLAN_PRICES`), and `pricing.tsx` (literal
  strings). Any price change must touch all three or they drift.

### 🟡 3.6 App-layer tenant isolation migration is 30% complete

The architecture is correct (`TenantScopedRepository` + `AsyncLocalStorage` +
a CI test that fails on raw `db` calls). But `no-unscoped-queries.test.ts:31`
**explicitly allowlists 6 of 9 action files**:

```ts
const ALLOWLIST = new Set([
  "tenants.ts", "users.ts",     // legit bootstrap
  "matches.ts", "teams.ts", "players.ts",
  "registrations.ts", "scorecards.ts", "follows.ts",  // TODO migrate
]);
```

Only `tournaments.ts` is fully repo-migrated. `matches.ts`, `scorecards.ts`, etc.
still hand-write `and(eq(X.tenantId, tenant.id))` on every query. One forgotten
clause = cross-tenant leak. The guard test passes *because it's allowlisted*,
not because the code is safe.

### 🟡 3.7 Admin super-admin email-match bypass still present

`apps/admin/src/lib/admin-auth.ts:26-29`:
```ts
const isEmailAdmin =
  SUPER_ADMIN_EMAIL &&
  user.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
if (!isRoleAdmin && !isEmailAdmin) return null;
```
A single env var (`SUPER_ADMIN_EMAIL`) grants full platform admin to anyone who
controls that email account — bypassing the DB `role` check. It was flagged in
the prior audit and is **still there**. Remove it; rely on `role === 'super_admin'` only.

---

## 4. Other findings (quality / correctness)

| # | Area | Finding |
|---|---|---|
| 4.1 | Pricing drift | Plan prices live in 3 files (§3.5). Consolidate to `PLAN_PRICES` in `@mtk/database` and import everywhere; render marketing from the same source. |
| 4.2 | WS namespace mismatch | `/scoring` (client) vs `/` (gateway) — see §3.1. Fix or document. |
| 4.3 | `edge-cache-service` | Empty dir, still referenced in `docker-compose.prod.yml`. Remove or implement. |
| 4.4 | Stray files | `nul`, `packages/database/nul`, `bash.exe.stackdump`, `expo-output.log`, root `dist/` — Windows `nul` redirect artifacts + build junk. Add to `.gitignore` / delete. |
| 4.5 | Duplicate docs | `DEPLOY.md`+`DEPLOYMENT.md`, `ENV_SETUP.md`+`ENV_SETUP_GUIDE.md`, `Readme.md`+`README-SETUP.md`, 3 audit docs. Consolidate to one each. |
| 4.6 | Sentry dev gap | `apps/web/instrumentation.ts` skips init outside prod → staging/dev errors invisible. At least init in staging. |
| 4.7 | `services/api` graceful-mock trap | `stripe.provider.ts`, `email.service.ts`, etc. fall back to mock mode when env unset. In prod, an unset `STRIPE_SECRET_KEY` makes `verifyPayment()` return `true` — **payments silently "succeed"**. Add a hard fail-fast in prod for payment-critical providers. |
| 4.8 | Scoring page UX | `useScoringStore.getState()` called during render (lines 239, 246, 252) — won't re-render on change. Use the hook selector form. |
| 4.9 | Match creation | `createMatchSchema` accepts `tenantId` from client input then validates `=== tenant.id` — correct, but the field shouldn't be client-sendable at all. Strip it like tournaments does. |
| 4.10 | CI gates | `ci.yml` + `ci-cd.yaml` both exist; neither has security scanning (CodeQL/gitleaks/`pnpm audit`) nor required status checks. |

---

## 5. Strengths to preserve

- **SSL/ACME automation** is genuinely excellent — real DNS-01, real cert parsing, renewal cron, manual-DNS fallback. This is the enterprise differentiator and it's real.
- **Repository + AsyncLocalStorage** design is the right isolation primitive; it's testable and enforces context. Finish migrating to it.
- **Plan-limits gating** (`plan-limits.ts` + team quota check in `teams.ts:80-87`) actually works and is centralized.
- **Guard tests** (`no-unscoped-queries`, `tenant-isolation`) are high-leverage — keep tightening the allowlist.
- **Drizzle schema** is comprehensive, typed, indexed (`match_balls` has 4 indexes ready for the scoring fix).
- **Rate limiter** is correctly multi-backend and Edge-safe.
- **Workspace hygiene** — secrets only in `.env.example`; impersonation now signed + audited.

---

## 6. Recommended plan (prioritized, shippable phases)

### Phase 1 — Fix the core product (scoring persistence)  · Effort: M · **Do first**
This is the only true 🔴 functional blocker. Everything else is risk reduction.

1. **Implement `ScoringService` for real** in `services/api/src/scoring/scoring.service.ts`:
   - `addBall` → `db.insert(matchBalls)` (tenant-scoped, via the repo or a `withTenantContext`).
   - `getMatchState` → aggregate from `match_balls` + `match_innings`.
   - `removeBall` → soft-delete / undo (migration `016_fix_trigger_undo_balls.sql` already supports this).
2. **Fix WS namespace**: set gateway `namespace: "/scoring"` to match the client.
3. **Add a server action fallback** `saveBall` in `apps/web/src/app/actions/` that writes to `match_balls` directly (so scoring works even if the WS service is down — online/offline sync already queues `pendingSync`).
4. **Remove hardcoded values** in `scoring/page.tsx`: pull `teamId` from match, `totalOvers` from `match.matchFormat`.
5. **Don't reset innings on matchId match**: hydrate from `match_balls` on mount instead of blank state.
6. **E2E test**: open match → score 6 balls → reload → assert balls persist (Playwright spec exists: `tests/e2e/specs/scoring.spec.ts` — wire it).

### Phase 2 — Resolve migration drift  · Effort: S · **Do immediately**
1. Reconcile the two migration histories: decide whether Supabase CLI or the `001-022` set is canonical.
2. Apply the missing migrations (`user_tenant_roles`, `subscription_plans`, …) to the **staging** DB, verify, then prod — via a single controlled `supabase db push` or a fresh baseline migration.
3. Add a CI check: `packages/database/scripts/sync-check.js` (already exists) runs in CI and **fails** if repo schema ≠ applied migrations.
4. Add the 2 missing tables to the live DB or remove the code that references them.

### Phase 3 — Finish tenant-isolation migration  · Effort: M
1. Migrate the 6 allowlisted action files (`matches`, `teams`, `players`, `registrations`, `scorecards`, `follows`) to repos, removing each from `ALLOWLIST` as you go.
2. The repo base class already exists — this is mechanical work, ~1 file/day.
3. Goal: `no-unscoped-queries.test.ts` passes with an empty allowlist (except `tenants`/`users` bootstrap).

### Phase 4 — Close the remaining security gaps  · Effort: S
1. Remove the `SUPER_ADMIN_EMAIL` email-match bypass (`admin-auth.ts`) — role-only.
2. Make payment/email providers **fail-fast in production** when their env keys are missing (no silent mock).
3. Add CI security gates: `gitleaks`, `pnpm audit --prod`, CodeQL; make lint+type+test **required** on PRs to `main`.
4. Init Sentry in staging too.

### Phase 5 — Make a backend decision  · Effort: L (strategic)
Pick exactly one and execute:
- **(A) Commit to the gateway:** route `web`/`admin` through `services/api-gateway`, gain one authz boundary + the ability to set Postgres session vars so RLS *actually fires* (then you have defense-in-depth, not just app-layer).
- **(B) Archive the services:** move `services/*` to a branch, drop them from `docker-compose.prod.yml`, stop maintaining two backends.

Either is defensible. Keeping 6,000 LOC of unused NestJS is not.

### Phase 6 — SaaS monetization maturity  · Effort: M
1. Wire a real payment provider into the upgrade flow (Stripe for cards, JazzCash/Easypaisa for PK). The `payment-service` already has Stripe — connect it via the chosen backend path from Phase 5.
2. Add Stripe-webhook handler with idempotency keys + retry (table `subscriptions` exists).
3. Consolidate pricing to a single source (`PLAN_PRICES`); render marketing + invoices from it.
4. Make feature-flag rollout real (table exists; gate the riskier Phase-1 changes behind flags).

### Phase 7 — Polish & cleanup  · Effort: S
1. Delete `nul`, `packages/database/nul`, `bash.exe.stackdump`, `expo-output.log`, root `dist/`; gitignore them.
2. Delete or implement `edge-cache-service`.
3. Consolidate duplicate docs.
4. Fix the render-time `useScoringStore.getState()` calls in the scoring page (use selectors).
5. Unify mobile onto Clerk (or document the dual-identity contract and ship a reconciliation job).

---

## 7. Suggested 3-week sprint

| Week | Focus | Deliverable |
|---|---|---|
| 1 | Phase 1 + Phase 2 | Scoring persists end-to-end + e2e green; migrations reconciled; missing tables applied; CI sync-check gates PRs. |
| 2 | Phase 3 + Phase 4 | All action files on repos (empty allowlist); admin bypass removed; providers fail-fast; CI security gates on. |
| 3 | Phase 5 decision + Phase 6 start + Phase 7 | Backend ADR written + first migration (or archival); real Stripe checkout on one plan; repo cleaned. |

---

## 8. TL;DR for the owner

You have a **real, well-architected white-label/SSL platform** bolted onto a
**cricket scoring product that doesn't actually save scores**. The security and
infrastructure work since the last audit is genuine and good. The four things
that move this from "demo-able" to "sellable and defensible":

1. **Make live scoring persist to the DB** (Phase 1) — the core feature is broken today.
2. **Reconcile the migration drift** (Phase 2) — prod DB ≠ repo; will bite on the next deploy.
3. **Finish the tenant-isolation repo migration** (Phase 3) — it's 30% done and the safety net only works when it's 100%.
4. **Decide on one backend and one auth system** (Phase 5 + §3.4) — stop carrying two.

Do those four and the platform is genuinely production-grade.
