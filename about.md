# Shakir Super League (SSL)

## Project Overview

**Shakir Super League (SSL)** is a multi-tenant cricket league management platform for tournament organizers, teams, and fans: live scoring, subscriptions, white-label branding, plus beta AI commentary and WebRTC streaming.

## Deploy status

**Not publicly deployed** (DNS for `ssl.mtkcodex.site` / `ssl.cricket` did not resolve as of 2026-09-23).

**Intended production domain:** `ssl.mtkcodex.site` (and `admin.` / `api.` / `ws.` subdomains) — see [`live.md`](./live.md).

## GitHub Repository

[https://github.com/Kaashmalik/mtk-ssl2026.git](https://github.com/Kaashmalik/mtk-ssl2026.git)

## Tech Stack

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Framer Motion, Zustand
- **Product backend:** Next.js server actions / Route Handlers + Drizzle ORM
- **Specialist backend:** NestJS v11 (scoring SoT, streaming, AI commentary, payments, analytics, notifications)
- **Database:** PostgreSQL (Supabase), Redis, Kafka, ClickHouse (analytics)
- **Auth:** Clerk
- **Media:** Cloudinary (admin uploads); Supabase Storage (payment proofs only)
- **Payments:** Stripe; Pakistan = manual JazzCash / EasyPaisa / bank + proof upload **now**, with online merchant checkout planned as the easier future path
- **Monitoring:** Sentry
- **Intended deploy:** Vercel (apps) + Docker/VPS (services) + Supabase — see `live.md`

Canonical architecture: [`docs/architecture/BACKEND_UNIFICATION_DECISION.md`](./docs/architecture/BACKEND_UNIFICATION_DECISION.md) (**Accepted**).

## Key features (honest)

1. **Ball-by-ball scoring** — Nest `scoring-service` is source of truth; charts/DLS UI on web; offline sequence via migration `023`.
2. **AI commentary** — **Beta** (not GA).
3. **WebRTC streaming** — **Beta** (not GA).
4. **Fantasy cricket** — **Pre-MVP / roadmap** (schema only; not shipped UI).
5. **Analytics** — ClickHouse service + Postgres scorecards / materialized views.
