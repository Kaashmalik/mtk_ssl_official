# ADR: Backend Unification Decision

**Status:** Accepted  
**Date:** 2026-06-20  
**Accepted:** 2026-09-23  
**Decision Maker:** Engineering team + stakeholders  

**Supersedes:** [`docs/adr/001-microservices-migration.md`](../adr/001-microservices-migration.md) (full “all traffic via microservices / DB-per-service” plan).

## Context

The codebase has a **dual-path backend architecture**:

### Path A — Next.js Apps (product CRUD)
Core product CRUD flows through **Next.js server actions** and **admin API routes**,
which talk directly to Postgres via Drizzle ORM:

- `apps/web/src/app/actions/` — server actions using `"use server"` + `db` / repositories from `@mtk/database`
- `apps/admin/src/app/api/` — route handlers with `verifySuperAdmin()`
- Most Next.js API routes that need data import `db` and execute Drizzle queries directly

### Path B — NestJS specialist services
Service directories under `services/` provide real-time and side-plane capabilities that should not be reimplemented as server actions.

| Service | Role under hybrid |
|---|---|
| `scoring-service` | **Canonical scoring SoT** (HTTP + WS + Kafka + Redis). Offline sync / `ball_sequence` (migration `023`). |
| `streaming-service` | Mediasoup WebRTC (**beta**) |
| `ai-commentary-service` | Kafka consumer / GPT commentary (**beta**) |
| `analytics-service` | ClickHouse analytics |
| `notification-service` | Push / email / SMS |
| `payment-service` | Stripe webhooks + JazzCash/EasyPaisa online provider scaffold; product currently ships **manual proof** for PK wallets, with online checkout as the planned UX upgrade |
| `api` | Tenants helpers + SSL/ACME white-label automation |
| `api-gateway` | HTTP/gRPC edge for specialist services when needed |
| `auth-service` | gRPC RBAC (Casbin); apps remain Clerk-auth |
| `tournament-service` | Exists; product tournament CRUD remains primarily Next.js until an explicit migration |

**Scoring decision (settled):** Nest `scoring-service` is source of truth. Web scoring server actions become a **thin proxy** to it — do not grow a second ball-write path.

## Decision

**Adopt the hybrid “Next.js owns CRUD; Nest owns specialists” strategy.**

### Keep (Nest):
- `scoring-service` (SoT)
- `ai-commentary-service`
- `analytics-service`
- `notification-service`
- `payment-service`
- `streaming-service`
- `api` SSL/ACME module
- `api-gateway` / `auth-service` as needed for specialist request paths

### Keep (Next.js + Drizzle):
- All primary product CRUD and admin surfaces
- Manual subscription / payment-proof flows
- Tenant branding and most tournament/team/player/match metadata

### Retire / do not revive:
- Duplicate stub modules (e.g. old unwired `matches` stubs)
- Empty `edge-cache-service`
- Aspiration to move *all* CRUD to Nest without a clear scale trigger

### Do NOT do (yet):
- Big-bang migration of all server actions to NestJS
- Claiming Kong / full DB-per-service / TimescaleDB as current production architecture

## Tenant isolation (accepted truth)

App-layer scoping is the control plane for Drizzle/`DATABASE_URL` traffic. RLS is PostgREST defense-in-depth. See `docs/PROJECT_GUIDE.md` §3 and §9.

## Consequences

- **Positive:** Clear ownership — developers know where to change CRUD vs real-time scoring.
- **Positive:** Scoring SoT enables offline sequence / idempotency work (`023`) without dual-write drift.
- **Negative:** Two runtimes to deploy (Vercel apps + VPS/Docker services).
- **Negative:** Auth remains Clerk in apps; gRPC auth-service only where specialists need it.

## References

- Phase 0 documentation reconciliation (2026-09-23)
- Migration `023_offline_sync_ball_sequence.sql`
