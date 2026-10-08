# Phase 1 — Production Readiness Audit (Requirements & Gaps)

Date: 2026-05-25

## Scope
- Requirements review and gap analysis only (no feature changes)
- Sources: REQUIREMENTS.md, Readme.md, ENV_SETUP.md, ENV_SETUP_GUIDE.md

---

## Requirements Matrix (Condensed)

### Functional (Core)
1) **League Setup (Multi-tenant)**
- Required: tenant creation, subdomain routing, branding, admin access
- Status: documented; web league setup form exists
- Gaps:
  - Verify tenant isolation in *all* services (API, scoring, notifications)
  - Confirm subdomain routing and custom domain setup
  - Validate white-label branding propagation

2) **Registration (Teams/Players)**
- Required: registration workflow, approvals, payment status
- Status: DB schema + web actions exist
- Gaps:
  - Missing mobile registration UI
  - Payment status sync between payment service and registrations

3) **Match Lifecycle**
- Required: schedule → toss → live scoring → results
- Status: web actions + scoring service exist
- Gaps:
  - Validate end-to-end flow across web/mobile/scoring WS
  - Confirm completion path writes results consistently

4) **Scoring & Realtime**
- Required: ball-by-ball, undo, live updates
- Status: scoring service + gateway exist
- Gaps:
  - Client integration completeness (web/mobile)
  - Offline reconcile / conflict resolution behavior

5) **User Management & RBAC**
- Required: RBAC enforcement, role permissions
- Status: RBAC exists in web
- Gaps:
  - Enforcement in API/services
  - Admin UI coverage verification

6) **Notifications**
- Required: push + transactional
- Status: docs + firebase requirement
- Gaps:
  - Expo Go limitations; dev build enforcement
  - Notification worker/queue confirmation

7) **Payments**
- Required: Stripe + JazzCash
- Status: env docs exist
- Gaps:
  - Webhook signature validation
  - Payment reconciliation reliability

### Non-Functional
A) **Security**
- RLS policies, tenant isolation, secrets hygiene
- Gap: verify cross-tenant access is blocked everywhere

B) **Reliability**
- retries, idempotency, graceful fallbacks
- Gap: error handling and retry policies per service

C) **Performance**
- caching, query optimization, websocket scalability
- Gap: API response profiling + caching strategy

D) **Observability**
- Sentry/logging/metrics
- Gap: ensure all services and apps are configured

E) **Deployment**
- ports, env, TLS, DNS
- Gap: production config parity validation

---

## Phase 1 Deliverables (Implemented)
- Requirements matrix (this document)
- Gap list and validation checklist

---

## Validation Checklist (Actionable)

### 1. Tenant Isolation
- [ ] API services: tenantId enforced on all reads/writes
- [ ] Scoring service: match access is tenant-scoped
- [ ] Notifications: subscription/event topics are tenant-scoped
- [ ] Web + Admin UI: verify tenant scoping in all list/detail pages

### 2. Payments
- [ ] Stripe/JazzCash webhook signature validation
- [ ] Idempotency keys on payments
- [ ] Registration paymentStatus reflects payment provider state

### 3. Scoring & Realtime
- [ ] Web client scoring + ws updates functional
- [ ] Mobile client scoring + ws updates functional
- [ ] Offline reconcile merges without duplication
- [ ] Undo ball correctly updates scorecard

### 4. Notifications
- [ ] Dev build required for push, Expo Go guarded
- [ ] FCM keys configured
- [ ] Notification queue/worker exists for delayed sending

### 5. Security & RLS
- [ ] RLS enabled for all tenant tables
- [ ] Service role keys used only in backend
- [ ] Public role read access minimized

### 6. Observability
- [ ] Sentry DSN configured across web/admin/services
- [ ] Centralized logs present for scoring/notifications

### 7. Environment Parity
- [ ] .env checklist complete for prod
- [ ] DNS/SSL configured for all subdomains

---

## Next Phase
Proceed to Phase 2: **Core Domain Implementation Audit**
- Registration → team/player → match setup → scoring → results
- Fixes applied where gaps are confirmed
