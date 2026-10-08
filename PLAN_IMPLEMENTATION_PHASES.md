# SSL — Implementation Plan: Phased, Chunked, Zero-Regression

> Execute chunk-by-chunk. **No chunk proceeds until its exit checks pass.** Never batch two chunks. Never skip type-check.
>
> **Re-baselined Oct 6 2026** — see §0.1. Most of Phases 1–3 and 6 are already
> implemented; do not rebuild them. `PLAN_ENHANCED_2026-10-04.md` holds the
> item-by-item status matrix.

---

## 0. Global Engineering Rules (apply to every chunk)

1. **Tenant isolation**: every query/filter includes `tenantId`. Use the helpers in
   `packages/database/src/tenant-context.ts`, or an explicit `eq(x.tenantId, tenant.id)`
   when the action already resolved the tenant. Public pages must use
   `getPublicTenantContext()` from `apps/web/src/lib/public-tenant.ts` — a bare
   primary-key read on a public route is a cross-tenant leak.
2. **RBAC**: all new server actions wrapped in `withAuth` from
   **`apps/web/src/app/actions/action-guard.ts`** (note: `src/app/actions/`, *not*
   `src/lib/` — the original plan had this wrong and every "wrap in withAuth"
   instruction pointed at a non-existent file). New admin APIs check the super-admin role.
   Personal, non-tenant-scoped surfaces (e.g. a notification bell) should use session
   presence + an active-tenant check rather than a permission that would wrongly
   exclude legitimate roles.
3. **Validation**: Zod on every API route body and every server action input.
   Clamp untrusted numeric inputs (e.g. a `limit` from a client component) —
   `Number.isFinite` + `Math.min/max` — before they reach a query builder.
4. **Env**: never hardcode URLs/ports. Read via `apps/web/src/lib/env.ts` or the
   service `src/env.ts` pattern.
5. **Types**: no `any`; strict TS. Run `pnpm --filter <pkg> type-check` after each chunk.
   Never paper over a type mismatch with `as` — derive types from the schema.
   `packages/database` types resolve from `dist/`, so **rebuild it after any schema edit**
   or services type-check against stale declarations.
6. **Lint/format**: `pnpm lint` clean; prettier before commit.
7. **No direct DB writes from web scoring actions** — scoring-service is SoT. ✅ Satisfied.
8. **Graceful degradation**: external providers (OpenAI, Twilio, WhatsApp, Resend,
   Stripe) must have a mock/fallback so dev works without keys.
9. **Ports**: verify unique before adding — web 3001, admin 3002, scoring 4002,
   notification 4008, streaming 5005, analytics 5003.
10. **Git**: one branch per phase, one commit per chunk, conventional messages.
11. **Concurrency**: any read-modify-write sequence (`max(id)+1`, check-then-insert,
    claim-then-write) must be serialised — `pg_advisory_xact_lock` for sequences, a
    conditional `UPDATE ... WHERE status = 'pending' RETURNING` for single-use claims,
    or a transaction for multi-write units. See §0.2.
12. **Auth on privileged routes**: fail **closed**. `undefined !== undefined` is false,
    so a bare secret comparison silently authorises when the env var is unset — check
    the env var explicitly and return 503, and compare with `timingSafeEqual`.
13. **Postgres privileges**: never assume a grant comes from `PUBLIC`. Supabase
    projects carry explicit per-role grants, so `REVOKE ... FROM PUBLIC` can be a
    silent no-op. Inspect `pg_proc.proacl` / `pg_class.relacl` before and after.
14. **Migrations**: do not run `supabase db push` or `db reset` against this project
    (see `supabase/MIGRATION_STATUS.md`). Write every migration idempotently
    (`IF NOT EXISTS` / `DROP IF EXISTS` / `CREATE OR REPLACE`) because replay is
    currently possible.

### 0.1 What is already done (do not rebuild)

Phase 1 chunks 1.1–1.6 · Phase 2 chunks 2.1, 2.2, 2.3, 2.5, 2.6 · Phase 3 chunks
3.1–3.4, 3.6, 3.7, and the port collision in 3.5 · Phase 4 chunks 4.2, 4.3, 4.4, plus
plan enforcement at `startStream` · Phase 6 chunks 6.1–6.4.

`apps/admin` (a separate Next.js app) owns `/users`, `/subscriptions`, `/audit-logs`,
`/live-streams` and `/api/impersonate`. **They are not missing from `apps/web` — do
not add them there.**

### 0.2 Hardening defects found after the plan was written

All fixed Oct 6. Listed because each was invisible to the phase tables and none
matched an existing chunk:

| Defect | Fix |
|---|---|
| Cron authorised callers when `CRON_SECRET` was unset | Fail closed + `timingSafeEqual` |
| Subscription downgrade branch unreachable | Split bounded-notify / unbounded-enforce |
| Redis match-state cache returned unvalidated, then WS-broadcast | Validate; drop on mismatch |
| `MatchState.status` matched no enum member | Derived from schema + compile-time guard |
| Public pages read by PK with no tenant filter | Tenant-scoped, fail-closed |
| Player ID issuance race (`pg_advisory_xact_lock` claimed, absent) | Real lock in a transaction |
| Invite could be redeemed twice | Atomic conditional claim |
| `x-tenant-slug` set on the response only | Forwarded on request headers |
| Hand-rolled `PLAN_LIMITS[x] ?? PLAN_LIMITS.free` in 4 places | `getPlanLimits()` helper |

Second pass (database / architecture, via MCP against the live project):

| Defect | Fix |
|---|---|
| `user_tenant_roles` never created in the DB | Created + RLS + backfill; `UNIQUE (user_id, tenant_id)` added to Drizzle |
| `player_all_time_stats` readable by `anon` (matview ⇒ no RLS) | Privileges revoked |
| `next_invoice_number` executable by `anon` | Explicit per-role revoke — `REVOKE FROM PUBLIC` was a no-op |
| Hardcoded super-admin email in `is_super_admin()` | Removed; now data-driven only |
| RLS ignored per-tenant roles | `current_tenant_id()` made junction-authoritative, legacy fallback |
| RLS recursion cycle (caught before shipping) | Dropped FORCE; removed self-referencing policy |
| `packages/database/dist` 2 days stale | Rebuilt — apps resolve types from `dist/`, not `src/` |
| 4 E2E specs deleted in the working tree | Restored via `git restore`; 3 type errors fixed |

---

## Chunk 0 — `scoring-service` tenant authorization ✅ done

**Closed Oct 6 2026.** This was the top security gap; it is now enforced
end-to-end. Scoring writes cannot cross tenants even though the service bypasses
RLS.

- Added `services/scoring-service/src/common/guards/tenant-scope.guard.ts`:
  requires a valid UUID in `x-tenant-id`, **fails closed**, attaches it to the
  request. Composed onto every mutation route alongside the existing service
  token guard.
- `scoring.service.ts`: every mutation (`recordBall`, `undoBall`, `createInnings`,
  `completeInnings`, `completeMatch`) now takes `tenantId` and scopes each query
  with `eq(table.tenantId, tenantId)` — including the `UPDATE`s and the player
  name lookups that feed the Kafka broadcast. A shared `assertTenantScope()`
  helper throws `NotFoundException` (not 403, which would confirm the id exists
  in another tenant).
- `apps/web`: `scoring-service-client.ts` sends `x-tenant-id` from the
  server-side session; `actions/scoring.ts` passes `tenant.id` to all four
  proxies.
- 13 new guard tests (`tenant-scope.guard.spec.ts`) cover missing/empty/
  non-uuid/injection/`uuid-with-junk` headers. 26 scoring-service tests pass.

**Second hole found and closed in the same pass.** `scoring.gateway.ts` exposed
`record-ball` and `undo-ball` WebSocket handlers that called
`ScoringService.recordBall` / `undoBall` **directly**, bypassing the controller,
the service token guard and tenant scope entirely. Verified zero callers:
`use-scoring-socket.ts` only emits `join-match` / `leave-match` and consumes
read-only events. Removed, making the gateway read/broadcast-only and scoring
single-writer. `SCORING_GATEWAY_TOKEN` removed from `.env.example` accordingly.

**Also fixed while reading the call sites:**
- `actions/scoring.ts` `getBallHistory` had **no tenant check at all** — any user
  holding `match:read` in their own tenant could read another tenant's ball-by-ball
  history by passing a known id. Now scoped through `matchInnings.tenantId`.
- `getMatchForScoring` team/innings/ball queries lacked tenant filters. Added.

### Honest limit of this fix
This is defence in depth, not authentication. The service still trusts whoever
holds `SCORING_SERVICE_TOKEN`; `x-tenant-id` catches a caller that forwards an
id it never verified, and guarantees a caller cannot act outside the tenant it
declared. It does **not** stop someone who already has the token from declaring
a different tenant. The real controls remain: keep the token server-side and
**do not expose this service publicly**. Documented in the guard's doc comment.

---

## Chunks previously listed as "remaining" that are NOT defects

Two chunks in an earlier revision of this document were recommended as top
priority without being verified first. Both were wrong. Do not implement them.

| Was | Reality |
|---|---|
| **Chunk 4.5** payment persistence ("only known data-loss bug left") | `payment.service.ts` already writes to `payments` via Drizzle with tenant-scoped reads. There is no in-memory `Map`. |
| **Chunk 4.6** persist stream state | The `Map`s in `mediasoup-router.service.ts` / `streaming.gateway.ts` hold mediasoup routers, transports, producers, consumers and connected WS clients — ephemeral WebRTC runtime state that correctly belongs in memory. Durable state already lives in `matches.stream_status` / `live_stream_url`. |

---

## Phase 4 — remaining chunks

### Chunk 4.1 — Shared `checkPlanLimit()` guard ✅ done

Closed Oct 6 2026, including the user-facing half.

- `packages/database/src/lib/plan-guard.ts`: `checkPlanLimit()` for numeric quotas
  and `checkPlanFeature()` for boolean capability gates. Both throw a structured
  `PlanLimitError` carrying `code: "PLAN_LIMIT_REACHED"`, current usage, the
  ceiling, the tenant's plan, and `suggestedPlan` — the cheapest tier that
  actually lifts the restriction, computed from `PLAN_LIMITS` rather than
  hardcoded.
- Boundary is `>=`: 4 teams on free is legal, a 5th throws.
- Deliberately **queries nothing** — the caller supplies an already-tenant-scoped
  count, so the guard cannot accidentally count across tenants.
- Replaced all three ad-hoc inline checks: `teams.ts` (`maxTeams`),
  `players.ts` (`maxPlayers`), `matches.ts` (`liveStreaming`).
- `PlanLimitError` embeds its detail as JSON in `message`, because a server action
  crossing the RSC boundary keeps only `message`/`digest` — `instanceof` does not
  survive the hop. 17 tests cover the boundary, the suggestion maths and the
  wire round-trip.
- `apps/web/src/lib/plan-limit-error.ts`: `resolveActionError()` recovers the
  detail client-side and guarantees the raw payload never reaches the UI. This was
  not theoretical — forms previously did `err.message`, which would have rendered
  `[PLAN_LIMIT_REACHED]{...}` to the user. 8 tests, incl. a corrupted-payload
  fallback.
- `apps/web/src/components/billing/plan-limit-notice.tsx`: presents the limit as a
  billing event with an "Upgrade to <plan>" CTA to `/dashboard/settings/billing`,
  and suppresses the red error toast in that case.
- Wired into the three real quota paths: create team, create player, start stream.

⚠️ `UpgradePlanModal` (manual bank transfer + proof upload) is still mounted
nowhere. That is a *different* flow from self-serve Stripe upgrade — wiring it in
is a product decision, not a bug fix.

### Chunk 4.7 — Trial + invoice PDF
- Set `trialEndsAt = signup + 14d` for new tenants (field exists, unused) + trial banner.
- Generate an invoice PDF on admin approval.

### Chunk 2.4 — Match intro/summary commentary triggers ✅ done
- See "Chunk 2.4 ✅ done" further down this file for the full write-up (the naive
  framing here hid a second break: no producer *and* a discarded result).

### Chunk 2.6 — PDF scorecard export
- `@react-pdf/renderer` or server-side HTML→PDF. Check `package.json` before choosing.

## Phase 3 — remaining

### Chunk 3.5 — Notification WS/SSE bridge
- notification-service has no gateway; push notifications silently no-op because
  `getUserTokens()` returns `[]`. Persist tokens first, then add the bridge.

## Phase 5 — Premium UX + Mobile

5.1 Landing redesign · 5.2 Mobile bottom tabs · 5.3 Responsive tables · 5.4 Touch
targets (≥44px) · 5.6 **Web offline scoring queue (IndexedDB — mobile has one, web
does not)** · 5.7 Scoring animations · 5.9 Bracket viz · 5.10 Team analytics ·
5.12 Mobile live view · 5.13 Stripe intl checkout.

Each sub-chunk: implement → type-check + lint → manual QA → commit.

### Chunk 5.3 / 5.4 — responsiveness audit ✅ done (Oct 7 2026)

Scanned all 170 `.tsx` files in `apps/web`. The primary mobile surface
(`/matches/[matchId]/scoring`) is **already correct**: `grid-cols-3 sm:4 md:6` ball
pad, 56px touch targets, `touch-manipulation active:scale-95`, `aria-label`s,
compact/full scorecard swap, `flex-1 sm:flex-none` tabs. Zero fixed multi-column
grids without a responsive prefix app-wide. Three real defects fixed:

1. **Tournaments points table** — 5 columns in a bare `CardContent` with an
   unbounded, untruncated Team cell; a long club name pushed P/W/L/Pts out of the
   card. Added `overflow-x-auto`, `min-w-[22rem]`, `truncate` + `max-w` on the Team
   cell (`title` keeps the full name reachable), `tabular-nums` on numerics. The
   dashboard equivalent already had `w-6` + `truncate`, which is why only this one
   was broken.
2. **Scoring page header** — `flex justify-between` with up to four children and no
   `flex-wrap`, guaranteed to collide at 320–375px, i.e. the device scorers use. Now
   wraps, with trailing controls in their own wrapping group.
3. **Touch targets 40px → 44px** (`min-h-10` → `min-h-11`) on Undo/Redo/End-Innings,
   closing the gap against this plan's own 5.4 target. Passed WCAG 2.2 AA before —
   this is consistency, not a regression fix.

Also routed "End Innings" failures through `resolveActionError` so a plan-limit error
shows an upgrade prompt instead of the raw wire payload in a toast.

Deliberately **not** changed: `user-list-table` / `registration-list` (they use the
UI library's `<Table>`, which supplies its own overflow container) and the
dashboard/leaderboard tables (already `truncate`d or only 3 columns).

Method note: no blanket restyling. Every change traces to a specific defect — after
three premises in this document turned out to be false on inspection, sampling was
replaced with a full scan.

## Phase 6 — remaining

### Chunk 6.5 — QA + Launch
- **E2E specs restored, but never executed.** `critical-paths`, `payments`,
  `scoring` and `tournament` were recovered with `git restore` (they had been
  deleted only in the working tree, never in a commit) and three real type errors
  were fixed (`page.click(...).first()` — `.first()` is a Locator method, called on
  a `Promise<void>`). `pnpm exec tsc --noEmit` in `tests/e2e` now passes.
- **They still cannot run**: the blocker is Clerk auth, not data. No user has a
  `clerk_id`, so no browser session can be created. Set `users.clerk_id` for a
  seeded user (or use a fixture token) before expecting these to pass.
- Load test WS + streaming. Sentry + health + uptime. Deploy.

---

## Exit-Check Commands (run after every chunk)

```bash
pnpm --filter @mtk/database build        # REQUIRED after any schema edit
pnpm --filter @mtk/web type-check
pnpm --filter @mtk/web lint
pnpm --filter @mtk/web test
pnpm --filter @ssl/scoring-service type-check
pnpm --filter @ssl/scoring-service test
# and the equivalent for whichever service was touched
```

Build only where the package has a `build` script. `packages/database` **must** be
built after a schema change — every app and service resolves it from `dist/`.

## ⚠️ Verified vs unverified — corrected Oct 7 2026

An earlier revision claimed the database held 0 rows everywhere. **That was wrong.**
It already contained the real tenant `ssl` ("Shakir Super League", enterprise), two
users, tenant branding, and reference data. Two conclusions were retracted:
`kaash0542@gmail.com` already holds `role = 'super_admin'`, so removing the
hardcoded-email backdoor locked nobody out; and E2E was never blocked by missing
data. It is blocked because **no user has a `clerk_id`**, so no Clerk session can
exist.

Having data exposed a live bug that reasoning had missed: **`kashif@maliktech.pk`
owns tenant `ssl` but had no `user_tenant_roles` row**, so `current_tenant_id()`
returned `{}` and RLS denied the league owner everything in their own league.
Fixed in `supabase/migrations/20261004240000_ensure_tenant_owner_has_role.sql`
(idempotent backfill + trigger; additive only, never demotes).

### Now verified by executing RLS (`SET LOCAL ROLE authenticated` + JWT claims)

| Scenario | Result |
|---|---|
| Single-tenant member | sees only own tenant's rows; 0 cross-tenant leakage |
| **Same user, two tenants, two different roles** | `league_owner` in Lahore, `scorer` in Karachi — both honoured; no third-tenant leakage |
| Repaired `ssl` owner | resolves to "Shakir Super League" (previously `{}`) |
| Genuine super admin | `is_super_admin()` true via `users.role` only |
| Free-plan quota boundary | exactly 4 teams / 40 players; one more must throw |
| Scorecard | aggregates derived from ball rows; recompute matches exactly |
| Owner-role trigger | fires on insert + owner change; no churn on unrelated updates; skips sentinel owner |

Advisor re-run after all changes: **no new findings.**

Seed lives in `supabase/seed.sql` (idempotent, fixed UUIDs, `.invalid` emails, no
`clerk_id`). Applied with `execute_sql`, **not** `apply_migration`, so seed rows
never enter migration history.

### Still unverified
- **No browser session exists** (no `clerk_id` on any user) → all server actions,
  RSC pages and the new upgrade prompts are unexecuted.
- The app has never been started.

### Second live bug found by the same audit (Oct 7 2026)

`refresh_player_all_time_stats()` is an **invoker-rights** trigger that runs
`REFRESH MATERIALIZED VIEW CONCURRENTLY`, which requires matview ownership. So any
`authenticated` write to `player_season_stats` aborts with
`permission denied for materialized view player_all_time_stats` — even though the
table's RLS policy (`FOR ALL`, TO `authenticated`) grants exactly that write. Caught
because the *control* case (own-tenant delete) failed during the write audit.

Latent, not live: nothing in the app writes `player_season_stats` today.
Fixed in `20261004250000_fix_matview_trigger_definer.sql` (`SECURITY DEFINER`, pinned
`search_path`, EXECUTE revoked from `anon`/`authenticated` — triggers do not check
EXECUTE at fire time, verified). The own-tenant delete now succeeds.

⚠️ Synchronous matview refresh on the write path is a known anti-pattern and is
**not** fixed here: one full rebuild per writing statement, and now reachable via
`SECURITY DEFINER`. The proper fix is `pg_cron` (available, not installed) or
refresh-on-read, trading immediate for eventual consistency — a product call.
`player_all_time_stats` is the only matview and is read by no application code, so
dropping it is also on the table.

### Full isolation audit (executed, not spot-checked)

- **Reads:** all 43 RLS-enabled tenant-scoped tables, single-tenant user.
  **0 real leaks.** The one flagged table (`fantasy_points_rules`) is a false
  positive — all 11 rows belong to the `system-default` sentinel and its policy is
  deliberately world-readable (`qual = 'true'`), the same pattern as
  `commission_rates`. `invoices` / `user_invites` are hard-denied by design.
- **Writes:** cross-tenant `INSERT` rejected by RLS; cross-tenant `UPDATE`/`DELETE`
  affected 0 rows; control own-tenant `UPDATE` affected 1 row — proving the zeros
  are RLS blocking, not absent grants.
- ⚠️ Latent gap: `public_read_fantasy_rules` is unconditional, so if a tenant ever
  adds custom point rules they would become visible to all tenants. None yet.

### Chunk 2.4 — Match intro/summary commentary ✅ done (Oct 7 2026)

The plan framed this as "trigger the two generation methods". Inspection found **two**
independent breaks; fixing only the trigger would have shipped a system that pays for
an OpenAI call and discards the text.

1. **No producer.** `kafka-scoring-publisher.service.ts` published only to
   `ssl.scoring.ball-events`. Nothing emitted to `ssl.match.events`, the topic
   `CommentaryController.handleMatchEvent` subscribes to — so both generation methods
   were unreachable dead code. Added `MATCH_EVENTS_TOPIC`, a `MatchEventPayload`
   contract and `publishMatchEvent()`, wired to the two real transitions
   (`scheduled -> live` → `MatchStarted`; `completeMatch` → `MatchEnded`).
2. **Result discarded even with a producer.** `handleMatchEvent` *returned* the string
   to Kafka, where nothing read it. Routed through the working path
   (`ssl.commentary` → `CommentaryBridgeController` → WS `commentary-update`) instead of
   inventing a second channel.

Correctness details:
- Fire-and-forget **after commit** — Kafka down must never roll back a committed score.
- `MatchStarted` emitted only on the genuine transition (`becameLive` flag captured in
  the transaction), not per ball.
- `completeMatch` is idempotent, so it records `wasAlreadyComplete` and emits
  `MatchEnded` only on the real transition; otherwise a retry or double-click
  generated a duplicate summary.
- Deterministic `idempotency-key` of `${matchId}:${type}`.

Frontend: `Commentary` gained `kind?: 'ball' | 'intro' | 'summary'`; `ballId` stays a
required string (empty for lifecycle entries) so existing consumers compile. This
exposed a dedup bug — the store keyed on `ballId + timestamp`, so with `ballId` empty
an intro would suppress a summary on a timestamp collision. Identity is now
`kind:ballId:timestamp`, defaulting to `"ball"` for pre-`kind` payloads. 8 new tests.

⚠️ Documented limitation: `publishMatchCommentary` copies one English string into both
`english` and `urdu` to keep the language-switcher contract working. It is **not** a
translation; real per-language intros need one generation per language, which
multiplies cost. A product decision, surfaced rather than assumed.

Unverified: the live Kafka round-trip (needs a broker + a scoring request, and no
Clerk session exists yet).

## Bug-Prevention Checklist per chunk
- [ ] tenantId on every query — including joins and lookups by id, **and in Nest services**
- [ ] RBAC guard present, or a documented reason a permission does not apply
- [ ] Zod validation on inputs; numeric inputs clamped
- [ ] No new `any`, no `as` hiding a type mismatch, no TODO stubs left
- [ ] Env-driven, mock fallback for external APIs
- [ ] Read-modify-write sequences serialised (lock, atomic claim, or transaction)
- [ ] Privileged routes fail closed on missing config
- [ ] Migration idempotent **and** reversible/forward-only safe
- [ ] `pg_proc.proacl` inspected after any REVOKE (PUBLIC revoke can be a no-op)
- [ ] No RLS policy references a function that reads its own table (recursion)
- [ ] `pnpm --filter @mtk/database build` run if the schema changed
- [ ] Manual smoke test done
- [ ] Commit message conventional

## Open follow-ups (not blocking)

- `acceptInvite` read-modify-writes `users.tenantIds` inside its transaction; two
  concurrent acceptances for one user can lose an entry. Needs `FOR UPDATE` or an
  array-append expression.
- `isUniqueViolation` duplicated in `apps/web/src/lib/db-errors.ts` and privately in
  `scoring.service.ts`. Fold together when the service is next touched.
- `player-ids.ts` / `users-invites.ts` remain CI-allowlisted. Both are correctly
  tenant-scoped; a repo layer would be churn, not security.
- 6 tables exist only as raw SQL and are invisible to Drizzle: `ai_commentary`,
  `ball_events`, `live_scorecards`, `notification_preferences`, `player_statistics`,
  `tournament_standings`. Give them schema definitions or retire them — but check
  for raw-SQL readers first.
- `pg_trgm` / `btree_gin` are installed in `public` (cosmetic advisor warning).

## ⚠️ Unverified — requires a human with runtime access

Type-checks (7/7 packages), 124 unit tests, direct DB queries and **executed RLS
isolation tests** pass. None of the following has been executed:

- ✅ **Super-admin pre-flight** — RESOLVED, no action needed. `kaash0542@gmail.com`
  already holds `role = 'super_admin'`, so removing the hardcoded-email backdoor
  locked nobody out. Confirmed by calling `is_super_admin()` under a simulated
  session. (An earlier note here wrongly said a grant was required.)
- ✅ **Per-tenant role test** — RESOLVED and proven against live RLS. One user is
  `league_owner` in Lahore and `scorer` in Karachi; both roles are honoured, and
  neither leaks the third tenant's rows. This is precisely the case the legacy
  `users.tenant_ids` array could not express.
- ⚠️ **Invite acceptance end-to-end.** Was broken by the missing table; now
  unblocked but still unproven at the app level.
- ⚠️ **Public-page tenant scoping.** Check `ssl.localhost:3001/matches/<id>` renders
  and a cross-tenant id 404s. `x-forwarded-host` vs `host` behind the proxy is
  runtime-only behaviour.
- ⚠️ **E2E specs** — blocked on Clerk auth, not on data. No user has a `clerk_id`,
  so no browser session can exist. Either set `users.clerk_id` for a seeded user
  or drive the specs with a fixture token.
- ⚠️ **Plan-limit upgrade prompts** — the guard is unit-tested and the boundary is
  seeded exactly, but the `PlanLimitNotice` has never rendered in a browser.