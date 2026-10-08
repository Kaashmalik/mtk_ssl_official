<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=250&section=header&text=Shakir%20Super%20League%20(SSL)&fontSize=50&animation=fadeIn&fontAlignY=38&desc=Pakistan’s%20Premier%20Cricket%20Tournament%20%26%20League%20Management%20Platform&descAlignY=55&descAlign=62" alt="SSL Header Banner" />
  
  <h3>Built by <strong>Malik Tech (MTK)</strong> • Led by <strong>Muhammad Kashif</strong></h3>

  <p>
    <a href="https://github.com/Kaashmalik/mtk_ssl_official/commits/main">
      <img src="https://img.shields.io/github/last-commit/Kaashmalik/mtk_ssl_official?style=for-the-badge&logo=github&color=7b16ff&labelColor=24292e" alt="Last Commit">
    </a>
    <a href="https://github.com/Kaashmalik/mtk_ssl_official">
      <img src="https://img.shields.io/github/repo-size/Kaashmalik/mtk_ssl_official?style=for-the-badge&logo=github&color=00b4d8&labelColor=24292e" alt="Repo Size">
    </a>
    <a href="https://nextjs.org/">
      <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" alt="Next.js">
    </a>
    <a href="https://nestjs.com/">
      <img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS">
    </a>
    <a href="https://supabase.com/">
      <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
    </a>
  </p>
  
  <p>
    <em>A multi-tenant cricket tournament management SaaS for Pakistan and the diaspora: leagues, teams, players, live scoring, subscriptions, and white-label branding.</em>
  </p>
</div>

---

## 🚀 Deployment Status

| Environment | Status | Target Domain |
|---|---|---|
| **Production** | 🚧 **Not publicly deployed** (as of 2026) | `ssl.mtkcodex.site` (web) |
| **API & Services** | 🚧 **Pending** | `api.ssl.mtkcodex.site`, `ws.ssl.mtkcodex.site` |
| **Marketing (Aspirational)** | 🔮 **Future Cutover** | `ssl.cricket` |

---

## 🏗️ Architecture (Canonical — Hybrid)

**Accepted decision:** [`docs/architecture/BACKEND_UNIFICATION_DECISION.md`](./docs/architecture/BACKEND_UNIFICATION_DECISION.md)  
*(ADR 001 microservices-first plan is **superseded** by that hybrid decision.)*

| Plane | Responsibilities | Technology Stack |
|-------|------|------|
| **Frontend (Next.js + Drizzle)** | Product CRUD, admin APIs, tenant branding, registrations | Next.js 15, React 19, Clerk, Supabase Postgres |
| **Backend (Nest Specialist Services)** | Scoring (SoT), streaming, AI commentary, payments webhooks, analytics, notifications | NestJS 11, Redis, Kafka, ClickHouse, mediasoup |

> **⚠️ Scoring Source of Truth:** `services/scoring-service` is canonical (incl. offline sync / `ball_sequence`). Web scoring server actions are a **thin proxy** toward that service. Do not add new ball-write logic in actions.
> 
> **🛡️ Tenant Isolation:** App-layer scoping (Clerk + Drizzle / `withTenantContext` / `tenant_id` filters) is the **real control plane**. Postgres RLS exists for PostgREST defense-in-depth. Most web/admin/Nest traffic uses `DATABASE_URL` and **bypasses RLS**. See [`docs/PROJECT_GUIDE.md`](./docs/PROJECT_GUIDE.md).

---

## ✨ Features Roadmap & Status

| Category | Status | Notes |
|----------|--------|-------|
| 🏏 **Tournament/Team/Player CRUD** | 🟢 **Shipped (App)** | Next.js server actions + admin routes |
| 📊 **Live Scoring UI** | 🟡 **Partial** | UI exists; Nest scoring-service is SoT |
| 📡 **Offline Sync** | 🔵 **In Progress** | Mobile hooks + migration `023`; web IndexedDB client pending |
| 💳 **Payments (PK)** | 🟡 **Manual (Online Later)** | Currently: JazzCash/EasyPaisa/Bank + Proof Upload. Future: Online API integrations |
| 🌍 **Stripe Integration** | 🟡 **Partial** | International path via `payment-service` |
| 🖼️ **Media Management** | 🟢 **Cloudinary & Supabase**| Cloudinary for uploads; Supabase for payment proofs |
| 🎙️ **AI Commentary** | 🟠 **Beta** | Early-access, not GA |
| 🎥 **WebRTC Streaming** | 🟠 **Beta** | Early-access, not GA |
| 🏆 **Fantasy Cricket** | 🔴 **Pre-MVP / Roadmap**| Schema only — not a shipped product feature |
| 🎨 **White-label / Custom Domain** | 🟡 **Partial** | Tables + settings + ACME path |
| 📈 **NRR & Auto-Scheduling** | 🔴 **Roadmap** | Planned for future releases |

---

## 🛠️ Complete Tech Stack

<details>
<summary><b>Click to expand the full tech stack</b></summary>

- **Monorepo:** Turborepo + pnpm 9
- **Frontend:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS + shadcn/ui + Framer Motion
- **Mobile:** Expo React Native (~54) + EAS
- **Product Backend:** Next.js Server Actions / Route Handlers + Drizzle ORM
- **Specialist Backend:** NestJS 11 services under `services/`
- **Database / Cache / Events:** Supabase (PostgreSQL), Redis, Kafka, ClickHouse (analytics)
- **Auth:** Clerk
- **Media:** Cloudinary (images); Supabase Storage (payment proofs)
- **Error Tracking:** Sentry
- **Intended Deployment:** Vercel (apps) + VPS/Docker (services) + Supabase
</details>

---

## 📂 Project Structure

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

## ⚡ Quick Start

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 9
- Supabase project
- Clerk project

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Kaashmalik/mtk_ssl_official.git
cd mtk_ssl_official

# 2. Install dependencies
pnpm install

# 3. Setup Environment Variables
cp .env.example .env.local
# (Fill Supabase, Clerk, Cloudinary, payment, Redis/Kafka keys in .env.local)

# 4. Start the development server
pnpm run dev
```

### 🌐 Local URLs
| App | URL |
|-----|-----|
| 🌍 **Marketing** | `http://localhost:3000` |
| 💻 **Web (League Portal)**| `http://localhost:3001` |
| ⚙️ **Super Admin** | `http://localhost:3002` |
| 🔢 **Scoring Service** | `http://localhost:4002` |
| 📱 **Expo (Mobile)** | `pnpm --filter mobile start` |

> **Full env contract:** [`.env.example`](./.env.example) | **Deploy plan:** [`live.md`](./live.md)

---

## 📚 Documentation

| Document | Purpose |
|-----|---------|
| 📖 [`docs/PROJECT_GUIDE.md`](./docs/PROJECT_GUIDE.md) | Product & architecture truth |
| 🏛️ [`docs/architecture/BACKEND_UNIFICATION_DECISION.md`](./docs/architecture/BACKEND_UNIFICATION_DECISION.md) | Hybrid backend (Accepted) |
| 📦 [`docs/adr/001-microservices-migration.md`](./docs/adr/001-microservices-migration.md) | Superseded by unification ADR |
| 🚀 [`live.md`](./live.md) | Go-live / `ssl.mtkcodex.site` deploy plan |
| 🤝 [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Contribution Guidelines |

---

## 📜 License

Proprietary • Owned by **Malik Tech (MTK)**

**Shakir Super League** — Built for cricket in Pakistan and worldwide.
