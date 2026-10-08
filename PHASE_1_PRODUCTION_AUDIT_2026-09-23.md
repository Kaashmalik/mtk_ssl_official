# Phase 1 Production Audit

**Date:** 2026-09-23  
**Scope:** Build, lint, TypeScript, environment validation, WebSocket reliability, offline scoring, GPT commentary resilience, and Sentry.  
**Audit rule:** Findings were recorded before source fixes.

## Executive summary

Phase 1 is **blocked**. The current working tree is not production-deployable and the requested architecture is not active:

- All ten NestJS services are deleted from `services/`, copied under untracked `archive/services/`, and removed from `package.json` and `pnpm-workspace.yaml`.
- The active web Socket.IO and IndexedDB/offline-sync modules are deleted.
- The active frontend build fails, lint fails, and type-check fails.
- Active scoring can lose writes; mobile offline synchronization can duplicate writes and sends a payload incompatible with the database schema.
- No active GPT commentary service exists. The archived service does fall back to deterministic commentary, but normal OpenAI failures bypass its circuit breaker.
- Browser Sentry is not initialized, staging cannot be separated from production, and NestJS coverage is incomplete.

The backend direction is a product/architecture decision that must be resolved before Phase 1 fixes: either restore the NestJS services as supported workspace packages or formally replace them with the current Next.js/Supabase architecture and remove the stale microservice deployment surface.

## Repository state and audit constraints

The audit was run against a working tree that already contained extensive uncommitted changes. Relevant pre-existing state:

- `package.json:8-10` and `pnpm-workspace.yaml:1-3` include only `apps/*` and `packages/*`.
- `services/*` is deleted in the working tree.
- Former services exist as untracked files under `archive/services/*`.
- `apps/web/src/hooks/use-match-data.ts`, `use-offline-sync.ts`, `use-socket.ts`, `apps/web/src/lib/indexed-db.ts`, `offline-sync.ts`, and `socket-client.ts` are deleted in the working tree.

No source fix was made. Build commands refreshed generated output under `.next` and `archive/services/*/dist`; a timestamp check found no archived `src/**/*.ts` files modified by the archived lint scripts. Those lint scripts use `--fix`, which is itself recorded below as a tooling defect.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| Active workspace build | **Fail** | `pnpm build`; `@mtk/web` fails bundling Node-only database modules into a client component. |
| Admin Next.js build | Pass with warning | `pnpm --dir apps/admin run build`; unused variable warning. |
| Marketing Next.js build | Pass with warnings | OpenTelemetry/Sentry dynamic dependency warnings; type validation and lint are skipped by its build. |
| Web Next.js build | **Fail** | `node:async_hooks`, `node:crypto`, `net`, `tls`, and `perf_hooks` enter the browser bundle through `billing-client.tsx:13`. |
| Active TypeScript | **Fail** | Three mobile errors at `apps/mobile/app/(tabs)/standings.tsx:41-42` and `apps/mobile/app/match/[matchId].tsx:192`. |
| Active lint | **Fail** | Database ESLint rule-definition errors; mobile error/warning; web/admin warnings. |
| Archived NestJS builds | 9 pass, 1 fails | `archive/services/api` cannot resolve `@mtk/database`; all services are outside the workspace. |
| Archived NestJS lint | Commands exit successfully | Scripts run ESLint with `--fix`, so they are unsuitable as CI verification commands. |
| Commentary failure behavior | Partial pass | Forced rejected generation returns deterministic fallback and opens the archived breaker; ordinary SDK failures are swallowed before reaching it. |

## Findings

### Blocker

#### P1-001 — Production backend has been removed from the active workspace

**Severity:** Blocker  
**Evidence:** `package.json:8-10`, `pnpm-workspace.yaml:1-3`, deleted `services/*`, untracked `archive/services/*`, `docker-compose.yml:164-173`, `docker-compose.prod.yml:259-273`.  
**Impact:** Normal install/build/test/CI does not include any NestJS microservice. Compose still references paths that no longer exist. Scoring, streaming, Kafka commentary, payments, notifications, analytics, and the API gateway therefore cannot be built or deployed from the active repository layout.  
**Required decision:** Restore and support the services, or formally replace the microservice architecture and deployment definitions.

### Build, TypeScript, lint, and warnings

#### P1-002 — Web production build imports server-only database code into a client bundle

**Severity:** Critical  
**Evidence:** `apps/web/src/app/dashboard/settings/billing/billing-client.tsx:1,13`; import chain reaches `packages/database/src/tenant-context.ts`, `packages/database/src/auth/impersonation-token.ts`, and `packages/database/src/client.ts`.  
**Observed failure:** Webpack cannot resolve `node:async_hooks`, `node:crypto`, `net`, `tls`, or `perf_hooks`.  
**Impact:** The primary web app cannot produce a production build.

#### P1-003 — Mobile TypeScript check fails

**Severity:** High  
**Evidence:**

- `apps/mobile/app/(tabs)/standings.tsx:41-42` passes `string | undefined` where `string` is required.
- `apps/mobile/app/match/[matchId].tsx:192` compares a status union to unsupported value `"upcoming"`.

**Impact:** The repository cannot pass required type-check gates.

#### P1-004 — Database lint configuration references an unavailable ESLint rule

**Severity:** High  
**Evidence:** `packages/database/src/repositories/base.ts:12,88` disables `@typescript-eslint/no-explicit-any`, but the package lint configuration does not define the rule.  
**Impact:** `pnpm lint` fails before checking all workspace packages.

#### P1-005 — Remaining active lint warnings/errors

**Severity:** Medium  
**Evidence:**

- `apps/mobile/app/scoring/[matchId].tsx:2` unused `Alert` import.
- `apps/mobile/app/scoring/[matchId].tsx:98` disallowed console statement.
- `apps/admin/src/components/users/users-management.tsx:44` unused `error`.
- `apps/web/src/app/dashboard/settings/billing/billing-client.tsx:130` unused `_clerkUserId`.
- `apps/web/src/components/tournaments/new-tournament-form.tsx:25` unused `_`.

**Impact:** Mobile lint fails; web/admin builds retain warnings contrary to the zero-warning target.

#### P1-006 — Next.js lint scripts are deprecated and archived lint scripts mutate source

**Severity:** Medium  
**Evidence:** `apps/admin`, `apps/marketing`, and `apps/web` invoke deprecated `next lint`; every archived service lint script invokes ESLint with `--fix`.  
**Impact:** Next.js 16 migration will break the current command, while archived CI-style lint checks can silently rewrite source rather than only validate it.

#### P1-007 — Marketing build emits dependency warnings and skips lint/type validation

**Severity:** Medium  
**Evidence:** Marketing build warns on expression-based/dynamic requires in OpenTelemetry and `require-in-the-middle`; build output explicitly says type validation and lint are skipped.  
**Impact:** Build output is not clean and successful compilation does not prove type/lint correctness.

#### P1-008 — Sentry source-map build warning is unresolved

**Severity:** Medium  
**Evidence:** Web/admin builds warn that source maps are generated but `sourcemaps.deleteSourcemapsAfterUpload` is not enabled.  
**Impact:** Source-map artifacts may remain in deployment output; behavior will also change under a future SDK default.

#### P1-009 — Archived API service cannot resolve its workspace database dependency

**Severity:** High  
**Evidence:** `archive/services/api` build reports six unresolved `@mtk/database` imports, including `src/app.controller.ts`, `src/main.ts`, `src/ssl/ssl.service.ts`, and `src/tenants/tenants.service.ts`.  
**Impact:** Even a direct build of the archived API fails until workspace/package resolution is restored.

### WebSocket and real-time reliability

#### P1-010 — Active web scoring loses writes after retry exhaustion

**Severity:** Critical  
**Evidence:** `apps/web/src/app/matches/[matchId]/scoring/page.tsx:307-332`; `apps/web/src/stores/scoring-store.ts:50-68,291-303`.  
**Impact:** The page retries three times and claims later synchronization, but the active store has no pending queue or sync action. A prolonged outage leaves persisted match state permanently behind the scorer’s local state.

#### P1-011 — Mobile runs two concurrent offline queue drainers

**Severity:** Critical  
**Evidence:** `apps/mobile/app/_layout.tsx:36-38`, `apps/mobile/app/scoring/[matchId].tsx:15-16`, `apps/mobile/src/hooks/use-offline-sync.ts:36-72`.  
**Impact:** The same queue is drained globally and again on the scoring screen, with no in-flight lock. Reconnection can submit duplicate ball inserts.

#### P1-012 — Mobile offline payload does not match the database schema

**Severity:** Critical  
**Evidence:** `apps/mobile/src/hooks/use-offline-sync.ts:45-55`; `packages/database/src/schema/match-balls.ts:26-46`.  
**Impact:** Sync sends `innings`, `over`, and `ball`, omits required `tenant_id` and `innings_id`, and does not use `over_number`/`ball_number`. Failed entries remain pending indefinitely and errors are not surfaced to the scorer.

#### P1-013 — Ball writes lack an idempotency contract and illegal deliveries collide

**Severity:** Critical  
**Evidence:** `apps/web/src/app/actions/scoring.ts:91-115`, `packages/database/src/schema/match-balls.ts:47-51`, `apps/web/src/stores/scoring-store.ts:148-158`.  
**Impact:** There is no client operation ID. A committed request whose response is lost is retried ambiguously. Consecutive wides/no-balls do not advance the legal-ball counter but reuse a uniqueness key based on match/innings/over/ball, so legitimate events can conflict.

#### P1-014 — Deleted web Socket.IO client created duplicate connections

**Severity:** High  
**Evidence:** `HEAD:apps/web/src/lib/socket-client.ts:25-41,140-142`.  
**Impact:** `ensureSocket()` replaces a socket that is still connecting; subscription calls it twice and can orphan the first socket and listeners. Reconnection also stops after ten attempts.

#### P1-015 — Deleted web socket cleanup was unsafe for multiple subscribers

**Severity:** High  
**Evidence:** `HEAD:apps/web/src/lib/socket-client.ts:66-89`; `HEAD:apps/web/src/hooks/use-socket.ts:55-64`.  
**Impact:** A `Set` is used instead of reference counts, so one component can leave a room for all consumers. Hook cleanup disconnects the global singleton and disrupts unrelated mounted subscribers.

#### P1-016 — Deleted IndexedDB queue removed events before acknowledgement

**Severity:** High  
**Evidence:** `HEAD:apps/web/src/stores/scoring-store.ts:283-305`; `HEAD:apps/web/src/lib/socket-client.ts:207-221`.  
**Impact:** Queued balls were emitted and immediately deleted without server acknowledgement. All queued records were replayed with the current innings ID, so multiple offline overs spanning an innings transition could be lost or assigned to the wrong innings. No multi-over conflict resolution existed.

#### P1-017 — Archived scoring event sequence allocation races

**Severity:** High  
**Evidence:** `archive/services/scoring-service/src/scoring.service.ts:220-233`; `packages/database/src/schema/scoring-events.ts:23-35`; `archive/services/scoring-service/src/scoring.gateway.ts:141-158`.  
**Impact:** `MAX(sequence)+1` is not serialized and the schema lacks aggregate/sequence uniqueness. Rapid concurrent balls can receive duplicate sequence values; broadcasts contain no ordering/version field for clients to repair ordering.

#### P1-018 — Archived API scoring service acknowledges phantom writes

**Severity:** High  
**Evidence:** `archive/services/api/src/scoring/scoring.service.ts:12-27,39-53`.  
**Impact:** The service assigns timestamp IDs without persistence and always returns empty match state. Restoring this gateway unchanged would broadcast success for data that was never stored.

#### P1-019 — Archived streaming gateway leaks Mediasoup resources

**Severity:** High  
**Evidence:** `archive/services/streaming-service/src/streaming.gateway.ts:33-40,142-149`; `archive/services/streaming-service/src/mediasoup-router.service.ts:63-87,119-155`.  
**Impact:** Disconnect/leave removes only client metadata. Transports, producers, and consumers remain in room maps unless the whole room is explicitly closed. There is no reconnect/session restoration path.

#### P1-020 — Active mobile realtime reconnect has no backfill

**Severity:** Medium  
**Evidence:** `apps/mobile/src/store/match-store.ts:88-126`.  
**Impact:** Supabase listeners are cleaned up correctly, but subscription status is not observed and state is not re-fetched after reconnect. Changes missed during disconnection can remain absent until a manual refresh.

#### P1-021 — Commentary event identity and delivery are unreliable

**Severity:** High  
**Evidence:** `archive/services/ai-commentary-service/src/commentary.service.ts:79-81,131-133,325-355`; `archive/services/ai-commentary-service/src/main.ts:10-26`.  
**Impact:** Cache/event identity uses only match plus over/ball and omits innings/event ID, allowing collisions. Per-match context is never evicted. Kafka publication failures are swallowed without retry/outbox, and no active producer for `ssl.scoring.ball-events` or consumer for `ssl.commentary` was found.

### Offline multi-over conflict-resolution verdict

**Result:** Fail.

Neither active client provides safe multi-over conflict resolution:

- Web queue/replay modules are deleted; failed writes are not queued.
- The deleted web implementation replayed with the current innings and deleted before acknowledgement.
- Mobile uses local random IDs that are not persisted as server idempotency keys, has duplicate drainers, sends a schema-incompatible payload, and has no authoritative server-version merge.

A production design requires immutable client operation IDs, ordered per-match/per-innings sequence numbers, transactional server acknowledgement, replay-safe uniqueness, explicit conflict responses, and UI reconciliation against authoritative state.

### GPT commentary resilience

#### P1-022 — No active GPT commentary service exists

**Severity:** High  
**Evidence:** Services are excluded from the workspace; `apps/admin/src/app/api/matches/[id]/commentary/ai/route.ts:9-36,109` uses hard-coded templates.  
**Impact:** The active product cannot provide the advertised GPT commentary. It is unaffected by OpenAI outages only because it never invokes OpenAI.

#### P1-023 — Archived circuit breaker is bypassed by ordinary OpenAI failures

**Severity:** High  
**Evidence:** `archive/services/ai-commentary-service/src/openai/openai.service.ts:18-49`; `archive/services/ai-commentary-service/src/commentary.service.ts:102-129,153-200`.  
**Validation:** A forced rejection at the commentary-service boundary returned deterministic multilingual fallback and opened the breaker after five failures. A forced SDK failure was caught inside `OpenAIService` and returned mock text instead of rejecting.  
**Impact:** Availability degrades, but ordinary API failures are counted as successes, breaker state is reset, and mock output is incorrectly labelled `generatedBy: "openai"`. There is no OpenAI retry/backoff.

#### P1-024 — Archived commentary Kafka startup/publication is not resilient

**Severity:** High  
**Evidence:** `archive/services/ai-commentary-service/src/commentary.service.ts:54-66,341-355`.  
**Impact:** Producer connection is started without awaiting it, risking unhandled startup failure. Publish errors are swallowed, with no retry or outbox.

#### P1-025 — Commentary resilience has no automated tests

**Severity:** Medium  
**Evidence:** `archive/services/ai-commentary-service/package.json:6-12`; existing Turbo log reports no tests; `tests/e2e/specs/scoring.spec.ts:139-154` only checks UI visibility.  
**Impact:** OpenAI failure, breaker transitions, cache degradation, Kafka failure, and fallback language behavior can regress unnoticed. The Playwright config also targets nonexistent package `@ssl/web` at `tests/e2e/playwright.config.ts:54-58`; the actual package is `@mtk/web`.

### Environment validation

#### P1-026 — Active environment schema is not executed

**Severity:** High  
**Evidence:** `apps/web/src/env.ts:15-35` has no imports; `apps/web/next.config.js:1-6` checks only two URLs. Admin, marketing, mobile, and active packages have no equivalent schema.  
**Impact:** Missing or malformed production configuration is discovered at runtime rather than build/startup.

#### P1-027 — Active environment variables are absent or mismatched in `.env.example`

**Severity:** High  
**Evidence:**

- Schema expects `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at `apps/web/src/env.ts:20-21`; `.env.example:23-25` documents unprefixed commented names.
- Missing `CLERK_WEBHOOK_SECRET`: `apps/web/src/app/api/webhooks/clerk/route.ts:28-33`.
- Missing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: `apps/web/src/lib/rate-limit.ts:97-100`.
- Missing `NEXT_PUBLIC_ADMIN_URL`: `apps/admin/src/lib/seo.ts:8`.
- Missing `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`: `apps/admin/src/components/layout/sidebar.tsx:151`.
- Missing Cloudinary public variables: `apps/admin/src/components/ui/cloudinary-upload.tsx:30-31`.
- Missing mobile `EXPO_PUBLIC_API_URL`, Supabase keys, and update URL: `apps/mobile/app.config.js:81-87`.
- Missing `EXPO_PUBLIC_PROJECT_ID`: `apps/mobile/src/hooks/use-push-notifications.ts:126`.
- Missing `SENTRY_AUTH_TOKEN` required for source-map upload.

#### P1-028 — `.env.example` contains contradictory and misleading configuration

**Severity:** High  
**Evidence:**

- Payment variables are duplicated with conflicting values at `.env.example:71-80` and `196-205`.
- `.env.example:3` instructs copying to `.env.prod`, which Next.js and the archived NestJS loaders do not automatically load.
- `SENTRY_PROJECT=ssl-web` at `.env.example:118` conflicts with admin’s `ssl-admin` setting.
- `SERVICE_NAME=web` at `.env.example:128` overrides admin’s fallback service name.
- `API_SERVICE_URL` is marked retired at `.env.example:139-140`, but `apps/web/src/app/api/cron/ssl-renewal/route.ts:45-56` still reads it and silently skips renewal when absent.

#### P1-029 — Archived NestJS schemas do not match the environment template

**Severity:** High  
**Evidence:**

- API schema has undocumented port, CORS, throttling, body/logging, authentication, WebSocket, retry, health, audit, role, response-wrap, and tenant-quota variables: `archive/services/api/src/env.ts:13-44`.
- API gateway host/port and service-address variables are undocumented: `archive/services/api-gateway/src/env.ts:5-14`.
- Scoring expects `REDIS_HOST`/`REDIS_PORT`, while the example provides `REDIS_URL`: `archive/services/scoring-service/src/env.ts:5-11`, `.env.example:29`.
- Streaming expects singular `CORS_ORIGIN` plus `PORT`: `archive/services/streaming-service/src/env.ts:4-13`.
- Auth, analytics, notification, payment, and tournament each have undocumented `PORT` variables.
- Scoring reads `SENTRY_DSN` directly but omits it from its schema: `archive/services/scoring-service/src/instrument.ts:3-6`.
- Example-only/unvalidated archived variables include `SMTP_FROM`, `STRIPE_WEBHOOK_SECRET`, and `JAZZCASH_ENDPOINT`.

### Sentry and observability

#### P1-030 — Browser Sentry is not initialized

**Severity:** High  
**Evidence:** Error boundaries call `captureException` at `apps/web/src/app/error.tsx:13-22` and `apps/admin/src/app/error.tsx:14-22`; neither app has `instrumentation-client.ts` or another browser `Sentry.init`. Server/edge-only initialization is at `apps/web/instrumentation.ts:48-56` and `apps/admin/instrumentation.ts:38-46`.  
**Impact:** Client render/runtime errors are generally not delivered to Sentry.

#### P1-031 — Source-map upload is not guaranteed in CI

**Severity:** High  
**Evidence:** `apps/web/next.config.js:58-70` and `apps/admin/next.config.js:126-138` configure Sentry wrappers, but `SENTRY_AUTH_TOKEN` is undocumented; `turbo.json:6-10` excludes `SENTRY_*` from build inputs; `.github/workflows/ci-cd.yaml:181-185` supplies only Turbo credentials.  
**Impact:** Production events may not map to source even though builds generate source maps.

#### P1-032 — Sentry environment and release tagging cannot distinguish staging

**Severity:** High  
**Evidence:** `apps/web/instrumentation.ts:20-45` and `apps/admin/instrumentation.ts:16-35` enable Sentry only when `NODE_ENV === "production"` and use `NODE_ENV` as environment. No `SENTRY_ENVIRONMENT` exists. `.env.example:121-122` claims a CI SHA release default, but CI does not set one.  
**Impact:** Development is unmonitored; staging production builds are tagged as production; releases may be uncorrelated.

#### P1-033 — NestJS Sentry coverage and server request capture are incomplete

**Severity:** High  
**Evidence:** Only archived API and scoring services initialize/capture Sentry (`archive/services/api/src/main.ts:21-25`, `archive/services/scoring-service/src/instrument.ts:3-7`). The other eight services have no initialization. No Nest source-map upload/release scripts exist. Active Next instrumentation does not export `onRequestError`.  
**Impact:** Errors across most backend services and some Next.js server request paths are invisible or lack usable stack traces.

## Existing test coverage relevant to Phase 1

- `tests/e2e/specs/scoring.spec.ts:115-136` covers nominal scoring only.
- `tests/e2e/specs/critical-paths.spec.ts:59-85` covers nominal connection/update behavior only.
- `tests/e2e/specs/scoring.spec.ts:139-154` checks commentary visibility only.
- No tests cover reconnect exhaustion, duplicate listeners/drainers, rapid ball ordering, acknowledgement loss, multi-over offline replay, innings transitions, idempotency, circuit-breaker transitions, cache outage, or Kafka publication failure.
- Existing scoring E2E routes reference absent `/scorer/...` pages.

## Recommended Phase 1 fix order

1. Resolve the backend architecture decision: restore NestJS services or remove/replace the microservice contract.
2. Restore a reproducible workspace and deployment topology; make every required backend participate in install/build/lint/test.
3. Fix the web build boundary, mobile TypeScript errors, and lint configuration/errors until all gates are clean.
4. Implement one authoritative, transactional, idempotent scoring write path before reconnect/offline polish.
5. Rebuild offline replay around acknowledgements, immutable operation IDs, ordered sequences, and authoritative reconciliation.
6. Fix WebSocket lifecycle/resource cleanup and reconnect backfill.
7. Restore real commentary processing, correct breaker semantics, and add focused failure tests.
8. Make environment validation executable and reconcile `.env.example` per deployable application/service.
9. Complete Sentry browser/backend initialization, environment/release tags, and source-map upload.

## Product decision required before fixes

Choose one supported production architecture:

- **Restore NestJS microservices (recommended for the stated target architecture):** move services back into the workspace, repair package resolution and Compose/CI, then fix each service in place.
- **Formalize Next.js/Supabase:** treat the service removal as intentional, replace the missing scoring/streaming/commentary/payment/notification capabilities in active packages, and remove stale microservice documentation/deployment configuration.
- **Audit a clean baseline:** if the current uncommitted deletion/archive operation is incomplete, provide the intended branch/commit and repeat Phase 1 against that state.

No Phase 2 work should begin until this decision and all Phase 1 blockers are resolved.
