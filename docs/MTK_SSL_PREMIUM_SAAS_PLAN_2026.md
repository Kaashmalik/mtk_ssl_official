# MTK SSL: Industry-Level SaaS Enhancement Plan (2026)

**Status:** Strategic roadmap based on repository documentation review  
**Last reviewed:** 2026-10-28  
**Scope:** Super Admin, Multi-Tenancy, White-Label, Premium UI/UX, and Rich Features

---

## Executive Summary

MTK SSL has strong technical foundations: 10 services, 4 apps, 6 shared packages, and 94 database migrations. However, **documentation does not equal production readiness**. The October 2026 roadmap explicitly labels many enhancements as *proposed*, with staging/device/provider acceptance pending. The focus should be **secure, polished, complete workflows** rather than adding more services or speculative features.

### Core Principle
> **One canonical scoring write path, enforceable tenant isolation, auditable administration, and designed-for-real-users UX.**

---

## 1. Super Admin: Full Platform Control

### Must-Have Capabilities

| Module | Capabilities | Safeguards |
|--------|--------------|------------|
| Platform overview | Active leagues, revenue, match activity, incidents, conversion | Scoped metrics, fresh data indicators |
| League management | Applications, approvals, provisioning, suspension, archive, restoration | Dual approval for destructive actions; audit trail |
| User management | Identity search, platform roles, support access, bans | No silent impersonation; consent + time-limited access |
| Billing operations | Plans, invoices, refunds, credits, disputes | Provider-verified webhooks; finance role separation |
| Moderation | Reports, chat, media, appeals, escalations | Queues, SLAs, evidence retention |
| Feature controls | Flags, entitlements, rollout cohorts | Server-side enforcement; kill switches |
| Domains & branding | DNS status, certificates, asset review | Ownership verification; safe fallback |
| Operations | Jobs, queues, errors, health, backups | Read-only by default; runbook-linked actions |
| Compliance | Data exports, deletion requests, audit evidence | Approval workflow; retention/legal hold |

**Implementation:** Extend `apps/admin` with a platform capability matrix; centralize authorization server-side. Every action needs actor, target tenant, reason, before/after state, and request ID. Build safe bulk operations with preview, dry-run, explicit confirmation, and reversible state where possible.

**Acceptance:** Two-person approval on high-impact actions; no cross-tenant access through admin proxies; 100% sensitive actions audited; denied actions logged without leaking data.

---

## 2. Multi-Tenant SaaS Foundation

### Tenant Lifecycle
```
application → review → provision → setup → active → restricted/suspended → archived
```

**Required:** Atomic tenant + owner membership + plan provisioning; idempotent retries; recovery for partial failures; explicit lifecycle transitions. Support members with multiple leagues, role assignment, invitation expiry/revocation, scorer handoff, and league switching without data bleed.

### Isolation Architecture
- **League = operational boundary.** Every tenant-owned record and relationship must validate league ownership.
- Derive actor/tenant from verified server-side identity and active membership, never client headers alone.
- Apply transaction-scoped tenant context where RLS is in use; privileged Drizzle/Nest paths require explicit authorization checks.
- Test negative cases: same resource ID across leagues, revoked memberships, stale offline actions, URL edits, export/download links, and cached responses.
- Paginate tenant-scoped reads; track quotas for users, storage, broadcasts, API requests, and plans.
- Add league-specific backup/export/deletion policy; avoid accidental cross-league cascades.

**Critical note:** `docs/PROJECT_GUIDE.md` says app-layer scoping is the real control plane for privileged Postgres clients. Do **not** assume RLS alone protects Next/Nest service paths.

---

## 3. White-Label: Productized Brand Studio

### Self-Service Workflow
1. Choose templates → configure typography, color tokens, logos, icons, email styling, scorecards, and public pages.
2. Live preview for desktop/mobile and light/dark modes; contrast and readability warnings.
3. Draft → review → publish → rollback with a versioned brand package.
4. Connect custom domain via ownership/DNS verification and managed TLS; show propagation/certificate states.
5. Provide tenant-scoped email identity only after SPF/DKIM/DMARC validation; use safe default sender until verified.
6. Enforce brand entitlements on the server; sanitize assets; allow simple plan downgrade fallback.

**Avoid:** Arbitrary CSS/HTML injection, unverified domains, inaccessible colors, tenant branding that obscures critical scoring controls, or a one-off app build for every league as a default offering.

**Acceptance:** No cross-tenant asset serving; brand version rollback works; domain failure falls back safely; keyboard/contrast remain accessible under every tenant theme.

---

## 4. Premium UI/UX: Designed, Not Template-Generated

### Design System
- Establish a distinctive cricket-centered visual identity with restrained color, strong typography, purposeful motion, and consistent spacing/density scales.
- Build design tokens with semantic roles (success, warning, destructive, focus) that cannot be overridden by unsafe brand colors.
- Document components and states in Storybook: navigation, data grids, command panels, live scorecards, timelines, media, dashboards, billing, and empty/error/loading/offline states.
- Favor information hierarchy over glassmorphism, excessive gradients, oversized cards, and decorative animations.

### Role-Based Experiences
- **Platform Admin:** Dense operations console, audit timelines, drill-down, actionable alerts.
- **Organizer:** Setup wizard, league health, registrations, schedule, sponsorship, approvals.
- **Scorer:** Fast high-contrast controls, undo/review, offline queue visibility, confidence in saved state.
- **Fan:** Match center, clean scorecards, live stream context, highlights, stats, notifications.

### Quality Bar
- Mobile-first but not mobile-only; desktop dashboards optimized for real operations.
- WCAG 2.2 AA, keyboard/focus coverage, reduced motion, RTL/localization, accessible tenant colors.
- Performance budgets: Core Web Vitals on representative devices; measure LCP, INP, CLS with real monitoring.
- Usability tests with actual scorers/organizers/fans; revise based on task success, errors, and comprehension.

---

## 5. Rich Premium Features: Ship Behind Verified Gates

### Core Pro Tier
- Tournament automation: fixtures, formats, eligibility, substitutions, standings, dispute handling.
- Advanced match center: ball-by-ball feed, scorecards, wagon wheels (only with reliable inputs), live notifications.
- Analytics: league/team/player trends with transparent calculations, exportable reports, scoped permissions.
- Sponsor management: placements, campaigns, brand-safe creative, impression reporting.
- Media library: authorized upload, moderation, processing, retention, playback and sharing controls.

### Enterprise Tier
- Multiple leagues under one billing organization **only after** league isolation is proven.
- Delegated administration, SSO, domain/email controls, audit exports, API keys/webhooks, SLA reporting.
- Versioned public APIs with per-tenant keys, quotas, webhooks, idempotency, and documentation.

### Experimental / Later
- AI summaries (labeled, reviewable, grounded in canonical score events); predictions with calibration/accuracy tracking.
- Fan chat, polls, fantasy, highlights, multi-platform broadcast: require moderation, rights, cost, provider-limit and age-safety reviews.
- Do not use unverified provider features or promise monetization splits not supported by contracts.

---

## 6. Billing and Entitlements

- Define plans from measured value: limits for teams, leagues, matches, media storage, broadcasts, API usage, support.
- Integrate a verified provider webhook flow with signature verification, deduplication, retries, auditability, and reconciliation.
- Expose invoices, taxes/currencies, trials, upgrades/downgrades, cancellations, grace periods, disputes, refunds, and spend alerts.
- Keep scoring continuity safe during billing restriction; distinguish financial restriction from security suspension.
- Never ship placeholder payments. Do not assume Stripe or any provider is configured until account/contract validation.

---

## 7. Delivery Plan: Evidence Before Expansion

| Phase | Outcome | Exit Criteria |
|-------|---------|---------------|
| 0. Baseline | Freeze scope, reconcile old docs with current code, establish reproducible test environment | Inventory of live routes, migrations, provider contracts, owner decisions |
| 1. Trust | Close tenant/identity/scoring/security gaps | Cross-tenant negative tests, real Postgres/RLS checks, offline replay and assignment acceptance |
| 2. Operations | Finish admin + onboarding + billing controls | Audited lifecycle transitions, safe support tools, provider-verified billing |
| 3. Brand & UX | Brand Studio + role-based product design | Accessibility, usability, performance and rollback acceptance |
| 4. Premium | Analytics, media, broadcast, engagement | Rights/moderation/cost gates, measurable adoption, staging/device tests |
| 5. Release | Progressive rollout and operations readiness | Restore drill, SLOs, alerts, incident/rollback runbooks, monitored canary |

**Delivery cadence:** Small slices with owner, exact changed files, tests, screenshot evidence, staging status, rollback, and blockers. Prioritize risk reduction over an arbitrary six-month feature promise.

---

## 8. First 30 Days: Practical Priorities

1. Reconcile `docs/SAAS_MASTER_PLAN_2026-10-12.md`, `docs/ENHANCEMENT_ROADMAP_2026-10-20.md`, and `docs/LOCAL_ACCEPTANCE_EVIDENCE.md` against current HEAD; mark *implemented*, *local-only*, *staging-unverified*, *proposed*.
2. Inventory admin routes/actions and build a capability matrix covering platform admin, support, finance, league owner, organizer, scorer and fan.
3. Run the current test suite in an approved local environment; prioritize two-tenant isolation, impersonation, provisioning rollback, scorer handoff, and offline replay tests.
4. Prototype one polished journey end to end: admin approves league → organizer configures brand → scorer records a match → fan sees live result.
5. Conduct 5+ observed sessions across organizer, scorer, and fan roles; document friction and iterate before broad UI redesign.

### Definition of Done per Feature
**Implementation + automated tests + role/tenant checks + accessibility + observability + documented failure recovery + real staging acceptance.** If any element is missing, label it incomplete.

---

## 9. Corrections to the Earlier Generated Report

The previous `./outputs/MTK_SSL_ENHANCEMENT_PLAN_2026.md` made several **unsupported assertions**: a 7/10 grade, <20% coverage, missing Stripe, absent contract tests, no domain automation, competitor comparisons, invented pricing/cost/ARR, and a Q3 2026 leadership claim. Treat these as **unverified**, not facts. The presence of migrations/services/docs does not prove a feature works in production. This plan avoids promising a fixed vendor, price, deadline, or competitive ranking without independent validation.

---

## Source Documents
- `docs/SAAS_MASTER_PLAN_2026-10-12.md` — baseline and release-critical gaps (notably section 3.3).
- `docs/ENHANCEMENT_ROADMAP_2026-10-20.md` — proposed phases and execution ledger.
- `docs/architecture/BACKEND_UNIFICATION_DECISION.md` — canonical product and specialist service boundaries.
- `docs/PROJECT_GUIDE.md` — tenant authorization model and security follow-ups.
- `docs/UI_UX_INDUSTRY_PLAN_2026-10-25.md` — UX phases and acceptance criteria.
- `CODEBASE_REVIEW_2026.md` — historical assessment; revalidate before using as current fact.

**Important:** This is a documentation-based review, not a completed code audit, production security assessment, or deployed-state verification.
