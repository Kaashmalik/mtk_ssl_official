# Phase 2 — Core Domain Flow Audit (Web + Services)

Date: 2026-05-25

## Scope
Registration → Team/Player → Match Setup → Scoring → Results

---

## Findings & Fixes Applied

### 1) Registration — Tenant Isolation
**Finding:** Duplicate registration check did not include tenant scoping, which could collide across tenants.
**Fix:** Added tenant filter in duplicate registration lookup.
- File: apps/web/src/app/actions/registrations.ts

### 2) Match Update — Scheduled Date Normalization
**Finding:** `updateMatch` accepted `scheduledDate` as a string but stored it without conversion.
**Fix:** Normalize `scheduledDate` to a `Date` or `null` before update.
- File: apps/web/src/app/actions/matches.ts

### 3) Scoring Gateway — Auth + Room Validation
**Finding:** Scoring socket accepted anonymous connections and allowed event emission without room membership checks.
**Fix:** Added optional token enforcement (when `SCORING_GATEWAY_TOKEN` is set), match room membership validation, and safer match state fetch error handling.
- File: services/scoring-service/src/scoring.gateway.ts

### 4) Web Scoring Socket — Auth Token Support
**Finding:** Web socket client did not attach any auth token during connection.
**Fix:** Added optional `NEXT_PUBLIC_SCORING_WS_TOKEN` handshake auth for scoring namespace.
- File: apps/web/src/lib/socket-client.ts

---

## Remaining Phase 2 Checks (In Progress)

### Registration Flow
- [ ] Verify payment status reconciliation and webhook updates
- [ ] Confirm approval pipeline reflects in match creation eligibility

### Match Lifecycle
- [ ] Validate toss → live → completed transitions in UI
- [ ] Ensure match status sync between web actions and scoring service

### Scoring & Realtime
- [ ] Confirm WebSocket client integration in mobile
- [ ] Validate undo ball updates scorecards correctly
- [ ] Offline reconcile behavior review

### Results & Standings
- [ ] Ensure results propagate to standings and stats views

---

## Next Actions
1. Audit web UI flow for match setup → scoring screens
2. Review scoring gateway auth + tenant constraints
3. Verify payments webhooks + registration sync
