# Phase 1 — Audit Report (Shakir Super League)

Date: 2026-09-23
Status: **Pre-fix**. This report lists every issue found before any code is changed, for scope review.

Legend for severity:
- **CRIT** — production blocker / data-loss / security hole
- **HIGH** — serious correctness, resilience, or coverage gap
- **MED** — quality / robustness gap
- **LOW** — hygiene, docs, config drift

---

## 0. Build / lint / typecheck status (as verified this session)

| Check | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | **FAILS** | Lockfile out of date vs `apps/web/package.json`. Specifiers in `pnpm-lock.yaml` (incl. `idb@8`, `socket.io-client`, `ioredis`, `postgres`, `vaul`) are absent from `apps/web/package.json:14-48`. Any CI install is broken today. Severity: **CRIT** (blocks all builds/CI). |
| `apps/web` TypeScript (`tsc --noEmit`) | **PASSES** (exit 0) | No TS errors on current tree. |
| `apps/web` eslint (flat-config) | **FAILS** | Root ESLint is v9 (flat config required) but `apps/web/.eslintrc.json`, `apps/admin/.eslintrc.json`, `apps/marketing/.eslintrc.json` are legacy `.eslintrc.*`. `eslint apps/web/src` → "couldn't find eslint.config.js", exit 2. Severity: **HIGH** (lint script `next lint` is broken under ESLint 9). |
| NestJS services build | **BLOCKED** | `services/*/node_modules` not installed (lockfile failure). Note: all 10 services DO have `eslint.config.mjs` (flat config), so service linting is correctly configured. |
| Monorepo tooling sanity | PASS | turbo.json tasks wire build/lint/type-check/test per workspace. |

---

## 1. Environment validation (Zod schemas vs `.env.example`)

Schema inventory: `services/*/src/env.ts` parse `process.env` with `z.object(...)`; `apps/web/src/env.ts` exists but is **never imported anywhere → dead code** (`apps/web/src/env.ts:35`). Only vars validated for web at build time are 2 in `apps/web/next.config.js:3-6`.

### 1.1 Vars in `.env.example` that no schema validates (HIGH/MED)
- `POSTGRES_USER/PASSWORD/DB` (lines 15-17), `SUPER_ADMIN_EMAIL` (47), `IMPERSONATION_TOKEN_SECRET` (53), `STRIPE_WEBHOOK_SECRET` (62), `JAZZCASH_ENDPOINT` (68), all 10 `NEXT_PUBLIC_PAYMENT_*` (71-80), `SMTP_FROM`, `TWILIO_*` (104-106), `SENTRY_ORG/PROJECT/RELEASE` (117-122), `SERVICE_NAME` (128), `CRON_SECRET`/`SSL_ADMIN_TOKEN`/`ACME_*`/`DNS_PROVIDER`/`CLOUDFLARE_*` (137-162).

### 1.2 Vars used in code but missing from `.env.example` AND all schemas (HIGH)
- `CLERK_WEBHOOK_SECRET` — `apps/web/src/app/api/webhooks/clerk/route.ts:29`
- `UPSTASH_REDIS_REST_URL/TOKEN` — `apps/web/src/lib/rate-limit.ts:98-99,242`
- `SCORING_GATEWAY_TOKEN` — `services/scoring-service/src/scoring.gateway.ts:214` (also not in `scoring-service/src/env.ts`)
- `JAZZCASH_INTEGRITY_SALT/JAZZCASH_BASE_URL/JAZZCASH_RETURN_URL` — `services/payment-service/src/providers/jazzcash.provider.ts:23,25,48`
- `OTEL_SERVICE_NAME/OTEL_EXPORTER_OTLP_ENDPOINT` — `services/api/src/common/utils/tracing.ts:7-8`
- `COMMIT_SHA` — `apps/web/src/app/api/health/route.ts:90`
- `SUPABASE_SERVICE_ROLE_KEY` — `apps/web/src/app/api/payments/upload-proof/route.ts:17` (non-null-asserted!)

### 1.3 Naming / shape mismatches (HIGH — real bugs)
1. `.env.example:68` documents `JAZZCASH_ENDPOINT` but payment code reads `JAZZCASH_BASE_URL` (`jazzcash.provider.ts:25`). Defined-but-never-read.
2. `.env.example:29` gives `REDIS_URL=redis://...`, but `scoring-service` schema/consumer use `REDIS_HOST`+`REDIS_PORT` (`services/scoring-service/src/env.ts:8-9`, `main.ts:35-36`) → with only `REDIS_URL` set it silently falls back to `localhost:6379`.
3. `.env.example:25` comments `SUPABASE_ANON_KEY`; web schema expects `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` (`apps/web/src/env.ts:20-21`) — different names.
4. `NEXT_PUBLIC_API_URL` has three conflicting values (schema default `http://localhost:4000`, example prod `https://api.yourdomain.com`, example dev `http://localhost:3000`) — 3000 matches neither web dev port (3001) nor API.

### 1.4 Structural problems (HIGH)
- **Nothing is truly required.** Every schema field is `.optional()` or `.default()` (e.g. `services/api/src/env.ts:15` `DATABASE_URL: z.string().optional()`). `.env.example` marks blocks "Required" but boot never fails on missing secrets.
- **Port default collision:** `payment-service/src/env.ts:5` and `streaming-service/src/env.ts:4` both default `PORT=5004`.
- **Scoring service `PORT` mismatch:** `main.ts:44` uses `process.env.PORT || 4000`, `env.ts:5` defaults 4002.
- `.env.example` itself duplicates `NEXT_PUBLIC_PAYMENT_*` twice with **conflicting values** (lines 71-80 vs 196-205); if shell-sourced, last wins.
- **Cross-app env files diverge:** each service loads `.env.local`/`.env` relative to its own CWD (e.g. `services/api/src/app.module.ts:18`, `services/auth-service/src/auth.module.ts:12`); no single shared template per app; no `.env.example` under `apps/*` or `services/*`.

---

## 2. WebSocket gateways

### 2.1 Streaming service — `services/streaming-service` (CRIT)
| # | Issue | Where |
|---|---|---|
| S-1 | **Zero authentication** on any socket handler; `cors: { origin: true }` | `streaming.gateway.ts:21,29-31` |
| S-2 | Disconnect/leave does **not** close transports/producers/consumers or the room | `streaming.gateway.ts:33-40,142-150` |
| S-3 | Mediasoup maps never pruned on close; `closeRoom` has **no caller anywhere** (`endStream` never invoked) → unbounded memory growth | `mediasoup-router.service.ts:66-68,76-87`; `streaming.service.ts:39-44` |
| S-4 | `dtlsstatechange` listener per transport never removed; closed transports stay in Maps | `mediasoup-router.service.ts:115-117` |
| S-5 | `produce`/`consume` handlers have no try/catch → partial resource states on error; transports usable across rooms; `producerIds/transportIds` unbounded | `streaming.gateway.ts:92-139` |
| S-6 | Room id namespace mismatch: client `join-room` uses raw `roomId`, `StreamingService.createStream` names rooms `stream-${matchId}` | `streaming.gateway.ts:42-55` vs `streaming.service.ts:22` |

### 2.2 Scoring service gateway — `services/scoring-service/src/scoring.gateway.ts`
| # | Issue | Where |
|---|---|---|
| SC-1 | **Auth auto-bypassed when `SCORING_GATEWAY_TOKEN` unset** (and var isn't in `env.ts`, so silently unvalidated) | `:213-215` |
| SC-2 | Non-constant-time token compare (`token === requiredToken`) | `:225` |
| SC-3 | 3 separate broadcasts per ball (`ball-recorded`, `score-update`, `wicket-fell`) — **no sequence number/version in payloads** → clients cannot order/dedupe | `:145-159` |
| SC-4 | `undo-ball` targets "last by `createdAt`" → tie-prone for rapid balls; no optimistic-lock | `scoring.service.ts:360-367` |
| SC-5 | `connectedClients` map is per-process → multi-instance deployment falsely rejects scorers | `:47,209-211` |
| SC-6 | No WS validation pipe/DTOs — malformed payloads reach DB | `:123-166` |
| SC-7 | Idempotency only via `(match, innings, over, ball)` check inside txn; second tap → generic 400 with no reconciliation event | `scoring.service.ts:168-182` |
| SC-8 | Wildcard CORS default | `:34-38`, `env.ts:7` |
| SC-9 | **No client exists** — `apps/web` has no `socket.io-client` anywhere; scoring is Server Actions + HTTP. Reconnection/backoff is therefore N/A client-side today, but the gateway has no `pingInterval/pingTimeout/connectionStateRecovery` either | — |

### 2.3 API service gateway — `services/api/src/scoring/scoring.gateway.ts`
| # | Issue | Where |
|---|---|---|
| A-1 | Interleaved `BallAdded` + `MatchStateUpdated` emissions, no sequence/version → UI regression risk on rapid balls | `:152-182,194-224` |
| A-2 | Extra DB read per ball event | `:173` |
| A-3 | Guard accepts token from two channels, non-constant-time compare; no per-match authorization once token valid | `common/guards/bearer-token-ws.guard.ts:28-33` |

---

## 3. Offline queue / scoring resilience

**Headline: the advertised IndexedDB queue does not exist.** `openDB`/`idb` has zero source references; the web "offline sync" feature was deleted (documented in `PHASE_1_PRODUCTION_AUDIT_2026-09-23.md:156-160`). `idb` remains only as a stale lockfile entry.

**Web (`apps/web`):**
| # | Issue | Where |
|---|---|---|
| O-1 | Retry-exhausted ball writes are **dropped** — only sets `dbWriteFailed` + toast "data will sync when connection is restored". **No queue exists; that sync never happens.** False promise to scorers. | `scoring/page.tsx:250-333`, `scoring-store.ts:50-68` |
| O-2 | Multi-ball / consecutive wides-no-balls: WD/NB don't advance `currentBall`, so two legal wides compute the same `over.ball` → second rejected by `UNIQUE(match,innings,over,ball)` → legitimate ball lost | `scoring-store.ts:148-158`; `packages/database/src/schema/match-balls.ts:48`; `scoring.service.ts:168-182`; `apps/web/src/app/actions/scoring.ts:21,96-97` |
| O-3 | `isOnline` badge dead: set once at store init, `setOnline` never called, no `online/offline` listeners in `apps/web` | `scoring-store.ts:127,252` |
| O-4 | No client op-ID / idempotency contract for retries | `apps/web/src/app/actions/scoring.ts:91-115` |
| O-5 | Local store re-hydrated from DB only when `matchId` changes or innings empty → never merges server-side balls from another device | `scoring/page.tsx:146-234` |

**Mobile (`apps/mobile`, AsyncStorage-backed, not IndexedDB):**
| # | Issue | Where |
|---|---|---|
| OM-1 | Two concurrent drainers (hook mounted globally + on scoring screen) with no in-flight lock → duplicate inserts | `app/_layout.tsx:37`, `app/scoring/[matchId].tsx:16`, `src/hooks/use-offline-sync.ts:36-72` |
| OM-2 | **Insert payload can never succeed**: sends `innings/over/ball/is_wicket/wicket_type/batsman_id/bowler_id`; schema requires `tenant_id/innings_id/over_number/ball_number`. `markBallSynced` only runs `if(!error)` → every entry stays pending silently. | `use-offline-sync.ts:45-55` vs `packages/database/src/schema/match-balls.ts:26-48` |
| OM-3 | Hardcoded `innings: 1` for every queued ball → innings-2/super-over balls queued wrongly | `app/scoring/[matchId].tsx:85` |
| OM-4 | Random `Math.random()` client IDs, never sent to server → no dedupe on retry | `app/scoring/[matchId].tsx:83` |

**Server event store:**
| # | Issue | Where |
|---|---|---|
| S-1 | **No unique constraint on `(aggregate_id, sequence_number)`** → concurrent `MAX(sequence)+1` can mint duplicate sequences | `packages/database/src/schema/scoring-events.ts:23-35`; `services/scoring-service/src/scoring.service.ts:221-233` |
| S-2 | WS broadcasts carry no sequence/version → clients can't repair after reconnect | `scoring.gateway.ts:145-151` |
| S-3 | No bulk replay endpoint (single `POST /scoring/ball` only); duplicates surface as generic 400 | `scoring.controller.ts:48-63` |

**Verdict: multi-over/multi-ball offline conflict resolution FAILS across web + mobile + server.** Data loss is possible on reconnect.

---

## 4. GPT commentary circuit breaker + Redis fallback (`services/ai-commentary-service`)

| # | Issue | Severity |
|---|---|---|
| C-1 | **Breaker can never trip.** `OpenAIService.generateText` never throws: missing key → mock; API exception → caught → mock (`openai.service.ts:24-26,46-49`). `circuitFailureCount` is only incremented by throws → real OpenAI outages are invisible; the `open`/`half-open` branches are dead code. | CRIT |
| C-2 | Repeated outages silently serve random/keyword-matched **mock text**, cache it 1h (`commentary.service.ts:93-96`), and label it `generatedBy:"openai"` → poor output persisted + misrepresented. | HIGH |
| C-3 | Deterministic 5-language fallback templates (`:211-263`) are unreachable in an outage (mocks always fill the slot). | HIGH |
| C-4 | Cache key `commentary:{matchId}:{over}.{ball}:{lang}` omits innings/tenant/eventId → innings-1 and innings-2 over 3.4 collide; multi-tenant leaks (`:79-81`). | HIGH |
| C-5 | Redis degradation one-way: any `error` event sets `this.redis = null` permanently → cache dead until restart (`:72-75`). | MED |
| C-6 | Kafka publish not resilient: `connect()` un-awaited, publish errors swallowed, no retry/outbox (`:54-66,341-356`). | HIGH |
| C-7 | **No producer feeds `ssl.scoring.ball-events`** — scoring-service never publishes to Kafka → commentary consumer gets nothing in full-stack run. | CRIT |
| C-8 | Match intro/summary bypass breaker, no fallback templates (`:265-286`). | MED |
| C-9 | `generatedBy` mislabels blended cached/mock/real results (`:154,171-177`). | LOW |
| C-10 | No retry/timeout on OpenAI SDK call; zero tests (`package.json:12` → `jest --passWithNoTests`). | MED |
| C-11 | `env.ts:3-9` validates only `NODE_ENV/KAFKA_BROKERS/OPENAI_API_KEY`; `REDIS_URL`, `OPENAI_MODEL` unvalidated. | MED |
| C-12 | Live app's admin "AI commentary" route is hard-coded templates (placeholder) — GPT feature effectively unused by the product today. | INFO/decision |

**Verdict: service availability degrades, but "circuit breaker" is non-functional and fallback semantics are wrong.**

---

## 5. Sentry

| # | Issue | Severity |
|---|---|---|
| Y-1 | Wired in: `apps/web` (`instrumentation.ts:41-56`), `apps/admin`, and only 2/10 NestJS services (`services/api/src/main.ts:21-25`, `services/scoring-service/src/instrument.ts:1-7`). **8 services have zero error monitoring** (api-gateway, auth, tournament, streaming, payment, notification, analytics, ai-commentary). | HIGH |
| Y-2 | Env tagging is only `NODE_ENV` — **staging is indistinguishable from production**. No `SENTRY_ENVIRONMENT` anywhere. | MED |
| Y-3 | Web uploads source maps via `withSentryConfig` (prod only, `hideSourceMaps:true`, tunnel `/monitoring`, `next.config.js:53-71`). NestJS services compile maps (`tsconfig sourceMap:true`) but **never upload them and set no release**. | MED |
| Y-4 | `captureConsole` not configured anywhere. | LOW |
| Y-5 | `scoring-service/src/env.ts` doesn't declare `SENTRY_DSN` yet `instrument.ts:4` reads it (bypasses Zod). | LOW |
| Y-6 | `apps/web/instrumentation.ts:23-25` no-ops outside `NODE_ENV=production` → no dev capture (intentional, but note: staging must set `NODE_ENV=production` or Sentry silently off). | INFO |

---

## 6. Consolidated severity-ordered punch list

### CRITICAL
1. Streaming gateway: no auth + no media teardown on disconnect + never-called `closeRoom` (S-1..S-6).
2. Offline scoring: web drops balls after retry exhaustion; mobile sync can never succeed vs schema; wides/no-balls collide on uniqueness key (O-1, O-2, OM-2).
3. Lockfile out of date → `pnpm install --frozen-lockfile` fails → all CI/builds broken.
4. No Kafka producer for ball events → commentary + notification consumers are silent in full-stack runs (C-7).
5. GPT circuit breaker is dead code; mocks poison the 1h cache as "openai" (C-1, C-2).
6. `uuid_generate_v7()` id DEFAULT is broken on all modern PostgreSQL (`get_byte() & x'0F'` → `integer & bit` operator error), so every INSERT that omits `id` fails. It is the DEFAULT on the `id` column of effectively every table (45 sites: 001's helper, 002's 12 tables, 004/007/008/009/010/011/015/018/020/021/022, 20260623). App paths mask it by always supplying `crypto.randomUUID()`; confirmed live whenever a scripted/raw insert relies on the DEFAULT (prime suspect for mobile's never-working supply-direct `match_balls` insert, which supplies ids... verify). Needs its own scoped migration + entanglement review; fix must not land inside migration 023.

### HIGH
6. ESLint 9 vs legacy `.eslintrc.*` on web/admin/marketing → lint broken.
7. Env validation largely dead/optional; web `env.ts` unused; JAZZCASH/REDIS/SUPABASE name mismatches; scored `PORT` collision (1.1-1.4).
8. Undo tie-prone; no sequence/version on any broadcast; interleaved emissions (SC-3/SC-4, A-1).
9. per-process `connectedClients` breaks multi-instance (SC-5).
10. `SCORING_GATEWAY_TOKEN` unvalidated + auto-bypass (SC-1).
11. 8/10 services lack Sentry.
12. Event-store lacks unique `(aggregate_id, sequence_number)` constraint (S-1).

### MEDIUM
13. Redis `error` permanently disables cache (C-5); Kafka publish fragility (C-6); intro/summary no fallback (C-8).
14. `isOnline` badge dead (O-3); no merge-on-rehydrate (O-5); mobile duplicate drainers (OM-1); hardcoded inning (OM-3).
15. Staging/prod Sentry env indistinct; no service release uploads (Y-2/Y-3).

### LOW
16. Wildcard CORS defaults; non-constant-time compares; `dtlsstatechange` listener cleanup; `PORT` mismatches; cache key collisions; `generatedBy` mislabel; `.env.example` duplicates.

---

## 7. Blockers and decisions needed

1. **Lockfile regeneration** is required before ANY build/CI can run. I need approval to run `pnpm install --no-frozen-lockfile` (was aborted twice this session) and commit the resulting lockfile + package.json reconciliation.
2. **Offline sync is a nonexistent feature with a false-promise toast.** Decision: (a) implement a real web queue (IndexedDB) + server bulk-replay endpoint, (b) remove the syncing toast/claims until it exists, or (c) mobile-only offline (fix the insert payload + innings bug). Recommend (a) for web + fixes to mobile.
3. **Commentary generation is not fed by Kafka** (no producer). Decision: add a scoring-service Kafka producer (emit ball events) vs. expose an HTTP hook + local queue. Also: pick the degrade semantics — mock text should NOT be cached or labeled `openai`; recommend labeling outage output `fallback` and short TTL.
4. **Streaming auth model**: recommend an explicit token-gated join flow + room lifecycle (close on zero participants) before the Mediasoup surface can be considered safe to ship publicly.
5. **ESLint migration**: replace legacy `.eslintrc.json` in web/admin/marketing with flat `eslint.config.mjs` (or pin ESLint 8). Recommend flat config to match the rest of the repo.
6. **Env contract**: choose authoritative var names (`JAZZCASH_BASE_URL` vs `JAZZCASH_ENDPOINT`, `REDIS_URL` vs `REDIS_HOST/PORT`, `NEXT_PUBLIC_SUPABASE_*`), make required fields truly required in schemas, dedupe `.env.example`.

## 8. Scope confirmation

Per Phase 1 working rules, no code has been modified. Only non-source artifacts were created: this report. Phase 1 fix work (build/lint/env/WS/offline/circuit-breaker/Sentry) will begin after you approve the scope and the two decisions in §7.