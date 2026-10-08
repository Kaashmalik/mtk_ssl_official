# Shakir Super League (SSL)
**Pakistan’s Cricket Tournament & League Management Platform**  
Built by **Malik Tech (MTK)** • Led by **Muhammad Kashif**

**Repository:** https://github.com/Kaashmalik/mtk-ssl2026.git

| | |
|---|---|
| **Deploy status** | **Not publicly deployed** (as of 2026-09-23). Target domains do not resolve yet. |
| **Intended production domain** | `ssl.mtkcodex.site` (web), `admin.ssl.mtkcodex.site`, `api.ssl.mtkcodex.site`, `ws.ssl.mtkcodex.site` — see [`live.md`](./live.md) |
| **Brand / marketing aspirational** | `ssl.cricket` (future cutover; not live) |

---

## About

SSL is a multi-tenant cricket tournament management SaaS for Pakistan and the diaspora: leagues, teams, players, live scoring, subscriptions, and white-label branding.

---

## Architecture (canonical — hybrid)

**Accepted decision:** [`docs/architecture/BACKEND_UNIFICATION_DECISION.md`](./docs/architecture/BACKEND_UNIFICATION_DECISION.md)  
(ADR 001 microservices-first plan is **superseded** by that hybrid decision.)

| Plane | Owns | Tech |
|-------|------|------|
| **Next.js + Drizzle** | Product CRUD, admin APIs, tenant branding, registrations | Next.js 15, React 19, Clerk, Supabase Postgres |
| **Nest specialist services** | Scoring (SoT), streaming, AI commentary, payments webhooks, analytics, notifications, SSL/ACME helpers | NestJS 11, Redis, Kafka, ClickHouse, mediasoup |

**Scoring source of truth:** `services/scoring-service` is canonical (incl. offline sync / `ball_sequence` — migration `023`). Web scoring server actions are a **thin proxy** toward that service (migration in progress; do not add new ball-write logic in actions).

**Tenant isolation:** App-layer scoping (Clerk + Drizzle / `withTenantContext` / `tenant_id` filters) is the **real control plane**. Postgres RLS exists for PostgREST defense-in-depth; most web/admin/Nest traffic uses `DATABASE_URL` and **bypasses RLS**. See [`docs/PROJECT_GUIDE.md`](./docs/PROJECT_GUIDE.md).

---

## Features (honest status)

| Category | Status | Notes |
|----------|--------|-------|
| Tournament / team / player CRUD | **Shipped (app)** | Next.js server actions + admin routes |
| Live scoring UI (charts, DLS calc, voice input) | **Partial** | UI exists; Nest scoring-service is SoT |
| Offline sync | **In progress** | Mobile hooks + migration `023`; web IndexedDB client not present |
| Payments (PK) | **Manual now; online later** | Both paths are planned. **Current shipping path:** JazzCash / EasyPaisa / bank + proof upload (Supabase Storage). **Future:** enable JazzCash/EasyPaisa merchant (online) APIs for one-tap checkout — easier for all users. Online provider code is scaffolded (JazzCash class; EasyPaisa stub). |
| Stripe | **Partial** | International path / payment-service |
| Media | **Cloudinary** (admin uploads) + **Supabase Storage** (payment proofs only) | No Cloudflare R2 |
| AI commentary | **Beta** | Early-access, not GA |
| WebRTC streaming | **Beta** | Early-access, not GA |
| Fantasy cricket | **Pre-MVP / roadmap** | Schema only — not a shipped product feature |
| White-label / custom domain | **Partial** | Tables + settings + ACME path |
| NRR / auto-scheduling / fantasy UX | **Roadmap** | Do not market as shipped |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Monorepo | Turborepo + pnpm 9 |
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| UI | Tailwind CSS + shadcn/ui + Framer Motion |
| Mobile | Expo React Native (~54) + EAS |
| Product backend | Next.js server actions / Route Handlers + Drizzle |
| Specialist backend | NestJS 11 services under `services/` |
| Database | Supabase (PostgreSQL); Redis; Kafka; ClickHouse (analytics) |
| Auth | Clerk |
| Media | Cloudinary (images); Supabase Storage (payment proofs) |
| Payments | Stripe; PK = manual proof now + online JazzCash/EasyPaisa later |
| Error tracking | Sentry |
| Intended deploy | Vercel (apps) + VPS/Docker (services) + Supabase — see `live.md` |

---

## Project Structure

```bash
mtk-ssl/
├── apps/
│   ├── web/               # League portal (target: ssl.mtkcodex.site)
│   ├── admin/             # Super Admin
│   ├── marketing/         # Landing
│   └── mobile/            # Expo iOS/Android
├── packages/
│   ├── ui/
│   ├── database/          # Drizzle schemas + repos
│   ├── dns-provider/
│   ├── observability/
│   └── config/
├── services/              # Nest specialists (hybrid — see ADR)
│   ├── scoring-service/   # Scoring SoT
│   ├── streaming-service/
│   ├── ai-commentary-service/
│   ├── payment-service/
│   ├── analytics-service/
│   ├── notification-service/
│   ├── auth-service/
│   ├── tournament-service/
│   ├── api-gateway/
│   └── api/               # Tenants + SSL/ACME helpers
├── supabase/migrations/
└── turbo.json
```

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 9
- Supabase project
- Clerk project

```bash
git clone https://github.com/Kaashmalik/mtk-ssl2026.git
cd mtk-ssl2026

pnpm install
cp .env.example .env.local
# Fill Supabase, Clerk, Cloudinary, payment, Redis/Kafka as needed

pnpm run dev
```

### Local URLs
| App | URL |
|-----|-----|
| Marketing | http://localhost:3000 |
| Web | http://localhost:3001 |
| Super Admin | http://localhost:3002 |
| Scoring service (default) | http://localhost:4002 |
| Expo | `pnpm --filter mobile start` |

Full env contract: [`.env.example`](./.env.example). Deploy plan: [`live.md`](./live.md).

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [`docs/PROJECT_GUIDE.md`](./docs/PROJECT_GUIDE.md) | Product & architecture truth |
| [`docs/architecture/BACKEND_UNIFICATION_DECISION.md`](./docs/architecture/BACKEND_UNIFICATION_DECISION.md) | Hybrid backend (Accepted) |
| [`docs/adr/001-microservices-migration.md`](./docs/adr/001-microservices-migration.md) | Superseded by unification ADR |
| [`live.md`](./live.md) | Go-live / `ssl.mtkcodex.site` deploy plan |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Contributions |

---

## License

Proprietary • Owned by **Malik Tech (MTK)**

**Shakir Super League** — Built for cricket in Pakistan and worldwide.
