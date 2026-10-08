# SSL — Enhanced Execution Plan (Verified Oct 4 2026 · **Re-baselined Oct 6 2026**)

> Supersedes `enhancementplane.md`.
>
> **Read §0 first.** The original plan was written against a codebase state that
> has since moved substantially. Roughly two thirds of the "confirmed gaps" it
> lists are already implemented. Building against it as written would rebuild
> working features and, worse, would not fix the defects that are still real.
>
> §0.3 records the database/architecture pass, which **corrects two items this
> document previously listed as open** (1.10 and 4.7) and adds the single largest
> remaining security gap.

---

## 0. Re-baseline (added Oct 6 2026)

### What changed since the original plan

The working tree gained most of Phase 1–3 and much of Phase 6. Verified present:

| Original claim | Reality |
|---|---|
| "No public `/matches/[id]`, `/live`, `/tournaments/[id]`, `/leaderboards`" | All four exist |
| "No `End Innings` button; `completeInnings` has zero callers" | Wired — `scoring/page.tsx:662` |
| "Header bell badge hardcoded `3`, no `/dashboard/notifications`" | Both fixed; `notification-bell.tsx` polls every 30s |
| "`CommentaryFeed` component does not exist" | Exists, and is reachable on the live page via `LiveOverlay` |
| "No Kafka consumer for `ssl.commentary`" | `scoring-service/src/commentary-bridge.controller.ts` |
| "No `verification_tokens` / OTP" | Table + `/api/auth/otp/{send,verify}` + `OtpInput` |
| "No `liveStreamUrl`/`streamStatus`/`streamSource`/`scorerId`" | Migration `20261004090000` + `scorer-assign.tsx` |
| "No player ID card generator" | `player-id-card.tsx`, `player_ids` table |
| "No fan reactions" | `fan-reactions.tsx` |
| "notification & streaming both on 5005" | Resolved — 4008 vs 5005 |
| "Dead Kafka consumers (zero handlers)" | Handlers exist in 4 services |
| "`/admin/*` missing" | They live in a **separate `apps/admin` Next.js app**, not `apps/web` |

### Items closed by the Oct 6 implementation pass

| Item | Evidence |
|---|---|
| **2.7** Web scoring actions proxy to scoring-service | Zero `db.insert/update/delete` remain in `actions/scoring.ts` |
| **4.2** Block live stream on `liveStreaming:false` plans | `matches.ts:startStream` via `getPlanLimits` |
| **4.5** `/api/cron/subscription-renewal` | Registered in `apps/web/vercel.json`; handler hardened |
| **3.4** Notification bell + page | Scoped to the caller's active tenant |

### New defects found and fixed (not in any plan)

1. **Cron auth bypass.** `secret !== process.env.CRON_SECRET` authorised the
   caller when the env var was unset *and* no header was sent — both sides
   `undefined`. Now fails closed with `timingSafeEqual`.
2. **Unreachable subscription downgrade.** `if (!type) continue` sat above the
   pause logic, so a subscription 10 days past due matched no notify bucket and
   was never paused or downgraded. Split into bounded-notify + unbounded-enforce.
3. **Unvalidated Redis match-state cache.** `getMatchState` returned
   `JSON.parse(cached)` typed as `MatchState`, then broadcast it to every WS
   subscriber. Now validated and dropped on mismatch.
4. **`MatchState.status` type lie.** Declared four values matching no
   `match_status` enum member, hidden by an `as` cast. Now derived from the
   schema, with a compile-time exhaustiveness guard.
5. **Cross-tenant reads on public pages.** `/matches/[id]`, `/matches/[id]/live`,
   `/tournaments/[id]` and the OG image read by primary key with no tenant
   filter — any holder of a UUID could read another tenant's scorecard and
   stream URL. Now tenant-scoped, fail-closed.
6. **Player ID issuance race.** A comment claimed `pg_advisory_xact_lock`
   serialised sequence allocation; no lock existed. Concurrent issuance failed
   on `UNIQUE (formatted_id)`. Real lock added.
7. **Double invite redemption.** `acceptInvite` read status then wrote it after
   four side effects, so concurrent redemption duplicated the role write and the
   notification. Now claimed atomically.
8. **Inert `x-tenant-slug`.** Set on the response only, so no server component
   could read it. Now forwarded on request headers.

### Behaviour changes requiring manual verification

⚠️ **Public pages are now tenant-scoped and fail closed.** They resolve the
tenant from the request host (`customDomain`, then subdomain slug). Reach them
via `https://<tenant>.example.com/matches/<id>` or, in development,
`http://ssl.localhost:3001/matches/<id>`, or set `PUBLIC_TENANT_SLUG`
(honoured **only** when `NODE_ENV !== "production"`). A bare `localhost:3001`
request has no tenant and will 404.

### Known gaps that remain

- ~~**`checkPlanLimit()` does not exist.**~~ **Closed Oct 6 2026.** Added
  `packages/database/src/lib/plan-guard.ts` with `checkPlanLimit()` (numeric
  quotas) and `checkPlanFeature()` (boolean capability gates), both throwing a
  **structured** `PlanLimitError` carrying `PLAN_LIMIT_REACHED` plus the numbers
  needed to render an upgrade prompt. All three ad-hoc inline checks
  (`teams.ts`, `players.ts`, `matches.ts`) now call the guard, so the arithmetic
  and copy can no longer drift. 17 guard tests + 8 resolver tests.
- **`packages/database` types resolve from `dist/`, not `src/`.** Rebuild the
  package after any schema edit or services type-check against stale declarations.
- **`acceptInvite` read-modify-writes `users.tenantIds`** (a Postgres array)
  inside its transaction; two concurrent acceptances for one user can lose an
  entry. Needs a row lock or an array-append expression.
- **`isUniqueViolation` is duplicated** in `apps/web/src/lib/db-errors.ts` and
  privately in `scoring.service.ts`. The service cannot import the web copy
  without rebuilding the workspace package.
- `player-ids.ts` / `users-invites.ts` remain on the CI allowlist. Both are
  correctly tenant-scoped; migrating them to a repo would be churn, not security.
- **Browser behaviour unverified.** The Oct 6 pass had no runtime access. Public
  page rendering and cross-tenant 404s are unit-tested and type-checked only.

### 0.3 Database & architecture pass (Oct 6 2026, later session)

Audited the live Supabase project directly via MCP: security advisor, `pg_proc`,
`pg_policies`, `pg_class`, `information_schema`. Four migrations applied.

#### Two items this document previously listed as open are NOT bugs

| Item | Was listed as | Reality |
|---|---|---|
| **4.7** payment persistence | "Open — only known data-loss bug left" | **Already persisted.** `payment.service.ts` writes to the `payments` table via Drizzle (`db.insert`, `db.update`, tenant-scoped reads). There is no in-memory `Map`. |
| **1.10** persist streams | "Open — streaming-service `activeStreams` is a Map" | **Misread.** The `Map`s in `mediasoup-router.service.ts` and `streaming.gateway.ts` hold mediasoup routers/transports/producers/consumers and connected WS clients — ephemeral WebRTC runtime state, which belongs in memory and is correctly rebuilt on reconnect. Durable stream state already lives in `matches.stream_status` / `live_stream_url`. |

Ranking 4.7 as the top remaining item was wrong; it should have been verified before
being recommended. Correcting the record rather than leaving it to mislead the next pass.

#### Closed by this pass

| Finding | Resolution |
|---|---|
| **`user_tenant_roles` table did not exist in the database** | Defined in Drizzle and read by `rbac-server.ts` on every tenant-scoped permission check, but never created. `acceptInvite` has no error handling around it, so invite redemption was hard-broken; RBAC silently fell back to legacy single-role. Created with RLS (not forced), 2 policies, backfill, and `UNIQUE (user_id, tenant_id)` added to the Drizzle schema. |
| **Cross-tenant leak: `player_all_time_stats`** | Materialized view, so RLS cannot apply; `anon` and `authenticated` both had SELECT. Projected `tenant_id`, so an unauthenticated `GET /rest/v1/player_all_time_stats` returned every tenant's player-to-stats mapping. Privileges revoked. |
| **Invoice sequence burn by anonymous callers** | `next_invoice_number` had explicit grants to `anon`/`authenticated` (not inherited from `PUBLIC`), so `REVOKE ... FROM PUBLIC` was a silent no-op. Revoked from the named roles. |
| **Hardcoded super-admin backdoor** | `is_super_admin()` contained `IF user_email = 'kaash0542@gmail.com' THEN RETURN true` — anyone registering with that address became super-admin regardless of `users.role`. Removed; super-admin is now data-driven only. |
| **Per-tenant roles were ignored by RLS** | `current_tenant_id()` read only the legacy `users.tenant_ids` array. Now junction-authoritative with legacy fallback (deliberately not a UNION — a union would *widen* access). |
| **RLS infinite-recursion cycle (caught pre-ship)** | `user_tenant_roles` had FORCE RLS and a policy calling `current_tenant_id()`; making that function read the table created a cycle that would have failed **every authenticated read**. Fixed by dropping FORCE and removing the self-reference. |
| **`packages/database/dist` 2 days stale** | Every app and service resolves `@mtk/database` from `dist/`, not `src/`. Rebuilt. |
| **4 deleted E2E specs** | Never deleted in a commit, only in the working tree — fully recoverable. Restored; also fixed 3 real type errors (`page.click(...).first()`, which is a Locator method called on a `Promise`). |

#### Schema sync verdict

| Check | Result |
|---|---|
| Drizzle tables defined | 49 |
| Tables present in `public` | 55 |
| **Drizzle tables missing from the database** | **0** |
| Tables in DB but absent from Drizzle | 6 legacy (see below) |

Legacy tables reachable only by raw SQL, invisible to Drizzle: `ai_commentary`,
`ball_events`, `live_scorecards`, `notification_preferences`, `player_statistics`,
`tournament_standings`.

Migration bookkeeping hazards (filename/recorded-version divergence, renamed
legacy files) are documented in **`supabase/MIGRATION_STATUS.md`**. Do not run
`supabase db push` or `db reset` against this project.

#### 🔴 Largest remaining security gap — ✅ RESOLVED Oct 6 2026

**`scoring-service` performed no tenant authorization.** Every controller handler
worked from `matchId` / `inningsId` alone — there was no `tenantId` anywhere in
`scoring.controller.ts`. It connects as `service_role`, which **bypasses RLS**, so
there was no database-level backstop either.

It relied entirely on the web app having authorized first. Now fixed:
`TenantScopeGuard` requires a valid `x-tenant-id` (fails closed) on every mutation,
and each service query is scoped with `eq(table.tenantId, tenantId)` plus an
`assertTenantScope()` check. 13 guard tests added.

Two further holes surfaced in the same pass and are also closed:
- `scoring.gateway.ts` had `record-ball` / `undo-ball` WebSocket handlers calling
  the service **directly**, bypassing the controller and every guard. Zero callers
  — removed; the gateway is now read/broadcast-only and scoring is single-writer.
- `actions/scoring.ts` `getBallHistory` had **no tenant check**, so any user with
  `match:read` could read another tenant's ball history by id.

⚠️ This is defence in depth, **not** authentication. Whoever holds
`SCORING_SERVICE_TOKEN` can still declare any tenant. The primary controls remain
token hygiene and keeping the service off the public internet.

#### ⚠️ CORRECTION — the database was NOT empty

An earlier revision of this document stated the database held 0 rows in all 55
tables, and built several conclusions on that. **That was wrong.** Once real data
was seeded and re-examined, the live project already contained:

| Table | Pre-existing rows | What it is |
|---|---|---|
| `tenants` | 2 | `ssl` = "Shakir Super League" (enterprise) — the real league; plus a `system-default` sentinel with an all-zero owner |
| `users` | 2 | `kaash0542@gmail.com` (role `super_admin`), `kashif@maliktech.pk` (role `fan`) |
| `tenant_branding` | 1 | branding for `ssl` |
| `commission_rates` | 4 | reference data |
| `fantasy_points_rules` | 11 | reference data |

Two conclusions in this document were therefore wrong and are retracted:

1. ~~"No user has `role = 'super_admin'`; the pre-flight is required."~~ —
   `kaash0542@gmail.com` **already** holds `role = 'super_admin'`, so removing the
   hardcoded-email backdoor did **not** lock anyone out. Verified by executing
   `is_super_admin()` under a simulated session: returns `true`, data-driven only.
2. ~~"E2E cannot pass; there is no data."~~ — there was always a tenant and users.
   The specs still cannot pass because **no user has a `clerk_id`**, so nobody can
   authenticate through Clerk. That is the actual blocker, not emptiness.

The lesson: "0 rows" was reported by a query that was never cross-checked. Absence
of evidence was recorded as evidence of absence.

#### 🔴 Live bug found once real data was visible: locked-out tenant owner

`tenants.owner_id` and `user_tenant_roles` are independent sources of truth with
nothing tying them together. `current_tenant_id()` reads the junction table, so a
tenant whose `owner_id` has no corresponding role row yields an owner who is
locked out of their own league — every RLS policy evaluates the tenant to NULL and
denies.

Confirmed on the real tenant before fixing:

```
tenant ssl (Shakir Super League, enterprise)
  owner_id -> kashif@maliktech.pk
  users.role = 'fan', users.tenant_ids = '{}', user_tenant_roles = 0 rows
  => current_tenant_id() = '{}' => owner sees nothing in their own league
```

Fixed in `supabase/migrations/20261004240000_ensure_tenant_owner_has_role.sql`:
idempotent backfill plus a trigger that maintains the invariant for future tenants
and `owner_id` changes. It only ever **adds** a missing row (`ON CONFLICT DO
NOTHING`) and never modifies or removes an existing role, so it cannot silently
promote or demote anyone. Placeholder owners (the all-zero sentinel) are skipped,
since they have no `users` row and the FK would reject. Verified: all 4 real tenant
owners now resolve; trigger fires on insert and on owner change but not on
unrelated column updates.

#### Still open from this pass

- Edge functions: **none exist** — nothing deployed, no `supabase/functions/`, no
  `/functions/v1` references. Not a defect; there is simply nothing there yet.
- `checkPlanLimit()` shared guard (4.1).
- `pg_trgm` / `btree_gin` installed in `public` (cosmetic advisor warning).
- **No runtime verification** of anything above. Type-checks, 44 unit tests and
  direct DB queries pass, but no application was started.

---

## 0.4 Seed data + first real RLS verification (Oct 7 2026)

`supabase/seed.sql` — idempotent, fixed UUIDs, `ON CONFLICT DO NOTHING`, applied
with `execute_sql` (deliberately **not** `apply_migration`, so seed rows never
enter migration history). Fixture emails use the reserved `.invalid` TLD with **no**
`clerk_id`, so they cannot authenticate and cannot be mistaken for real users.

The fixture is shaped to make previously-unprovable claims provable, and one of
them immediately paid off (the lockout above).

### Verified by executing RLS, not by inspection

Simulated authenticated sessions via `SET LOCAL ROLE authenticated` +
`request.jwt.claims`, then queried real tables. This is the first time tenant
isolation has been demonstrated rather than reasoned about.

| Scenario | Result |
|---|---|
| `seed_scorer`, member of Lahore only | sees 4 teams / 40 players / 1 match; **0** Islamabad and **0** Karachi rows leaked |
| `seed_owner@lahore`, **owner in Lahore + scorer in Karachi** | 2 tenants, per-tenant roles `lahore-lions=league_owner`, `karachi-kings=scorer`; sees exactly its 6 teams; 0 Islamabad leaked |
| `kashif@maliktech.pk`, real owner of `ssl` | `current_tenant_id()` now resolves to "Shakir Super League"; **0 rows before the fix** |
| `kaash0542@gmail.com`, genuine `super_admin` | `is_super_admin() = true` (data-driven, no hardcoded email); sees all 8 teams / 46 players / 2 matches with an empty tenant scope, as intended |
| Quota boundary | `lahore-lions` (free) sits at exactly 4 teams and 40 players = `maxTeams` / `maxPlayers`; a 5th team / 41st player must raise `PLAN_LIMIT_REACHED` |
| Scorecard integrity | innings aggregates are **derived from** the ball rows (53 runs / 2 wickets / 48 balls = 8.0 overs) and recomputed identically — the scorecard cannot disagree with its own ball history |
| Owner-role trigger | fires on tenant insert and on `owner_id` change; adds a row for the new owner; does **not** churn on unrelated column updates; skips the all-zero sentinel owner |

Security advisor re-run after all of this: **no new findings**. The 3 fail-closed
tables, 2 public-schema extensions and 4 RLS-dependency `SECURITY DEFINER` helpers
are the same known-intentional set as before, and the new
`ensure_tenant_owner_role()` does not appear — confirming its execute grant was
revoked.

### What is still genuinely unverified
- **No browser session exists.** No user has a `clerk_id`, so Clerk cannot
  authenticate anyone. All app-level checks (server actions, RSC pages, the new
  upgrade prompts) remain unexecuted. This, not missing data, is the blocker.
- The app itself has never been started.

---

## 0.5 Exhaustive isolation audit + a second live bug (Oct 7 2026)

The §0.4 tests spot-checked three tables. This pass audits **every** one.

### Read isolation — all 43 tenant-scoped tables, single-tenant user

Counted rows visible vs. rows in the caller's tenant for every RLS-enabled table
with a `tenant_id`, as a simulated `authenticated` session:

**1 table flagged — and it is a false positive.** `fantasy_points_rules` shows
`visible(11) > in_scope(0)`, but all 11 rows belong to the `system-default`
sentinel (`0000…0000`) and its policy is `public_read_fantasy_rules` with
`qual = 'true'`. It is deliberately world-readable reference data — the same
pattern as `commission_rates` (`qual = 'is_active'`). Correctly designed.

**Net: 0 real read-isolation leaks across 43 tables.**

Two tables are absent from the audit because they are hard-denied by design
(`invoices`, `user_invites`: RLS `FORCE`d, zero policies, no grant — the query
errors, which *is* the fail-closed behaviour).

⚠️ Latent design gap, not a live bug: because `public_read_fantasy_rules` is
unconditional, if a tenant ever stores custom point rules they would be visible to
every tenant. No tenant-owned rows exist yet.

### Write isolation — attacks executed, not assumed

Attacker scoped to Lahore only; Islamabad is the victim tenant.

| Attack | Result |
|---|---|
| `INSERT` team into victim tenant | **rejected** — `new row violates row-level security policy for table "teams"` |
| `INSERT` into `player_season_stats` for victim tenant | **rejected** — same RLS violation |
| `UPDATE` victim tenant's team | **0 rows**; the victim row is not even readable (`null`) |
| `UPDATE` victim tenant's matches | **0 rows** |
| `DELETE` victim tenant's players | **0 rows** |
| Control: `UPDATE` own tenant's team | **1 row** — proves the zeros are RLS blocking, not missing grants |
| Control: `DELETE` own tenant's player | **1 row** (this is the case that exposed the bug below) |

### 🔴 Second live bug: a trigger silently breaks a granted write

`player_season_stats` has a working tenant-isolation policy (`FOR ALL`, TO
`authenticated`), so authenticated users are *supposed* to write their own tenant's
rows. They cannot: every write fires
`trigger_refresh_player_all_time_stats`, which calls
`refresh_player_all_time_stats()` — an invoker-rights trigger. `REFRESH
MATERIALIZED VIEW CONCURRENTLY` needs ownership of the matview, so as
`authenticated` the write aborts:

```
DELETE FROM players WHERE name = 'Lahore Player 01';
ERROR:  permission denied for materialized view player_all_time_stats
```

Latent rather than live: no application code writes `player_season_stats` (read-only
in web and mobile via Drizzle on a privileged connection). But the RLS policy
advertises a capability a trigger silently breaks, and the first person to
implement season-stat writes hits it.

Fixed in `supabase/migrations/20261004250000_fix_matview_trigger_definer.sql`:
`SECURITY DEFINER` + pinned `search_path`, and `EXECUTE` revoked from
`anon`/`authenticated` (Postgres does not check EXECUTE when a trigger *fires*, so
this blocks direct calls without disabling the trigger — verified by re-running the
write). Verified: the own-tenant delete now succeeds.

⚠️ **Deliberately not "fixed":** refreshing a matview synchronously on the write
path is a known anti-pattern — it costs a full rebuild per writing *statement*, so
a loop of single-row inserts means one rebuild per row, and now that the function
is `SECURITY DEFINER` a tenant with write access can amplify writes into repeated
rebuilds. The proper fix is to move the refresh off the write path (`pg_cron` is
available on this project but not installed), which changes freshness from
immediately- to eventually-consistent — a product decision, so it is flagged rather
than imposed. Also worth weighing: `player_all_time_stats` is the project's only
matview and is referenced by **no application code** (only migration `017` and the
docs), so dropping it would remove the problem rather than manage it.

Advisor re-run after this fix: no new findings.

---

## 0.6 Responsiveness audit — what was already fine, and the 3 real fixes

Scanned all 170 `.tsx` files in `apps/web` rather than sampling, because two earlier
premises in this document ("responsive tables are missing", "web has no offline
queue") turned out to be false on inspection. Sampling would have repeated that.

### Already correct — do not "fix" these

The primary mobile surface, `/matches/[matchId]/scoring`, is well built:

- `ball-input.tsx`: `grid-cols-3 sm:grid-cols-4 md:grid-cols-6`, `min-h-14`
  (**56px**) touch targets on mobile, `touch-manipulation active:scale-95`,
  per-button `aria-label`.
- Scorecard uses `hidden sm:block` / `sm:hidden` to swap compact-vs-full.
- Tabs use `flex-1 sm:flex-none`, which fits three short labels even at 320px.
- The page uses `sm:` (44×) and `lg:` — the absence of `md:` is not a defect, since
  the ball pad itself supplies the `md:` step.
- **0** fixed `grid-cols-[4-9]+` without a responsive prefix anywhere in the app.

### Real defects found and fixed

1. **Tournaments points table overflowed on narrow screens.** 5 columns inside a bare
   `CardContent`, with an **unbounded, untruncated** Team cell. A long club name would
   push P/W/L/Pts out of the card. Notably the *dashboard* points table has `w-6` +
   `truncate` and was fine — the tournaments one had neither. Added
   `overflow-x-auto` wrapper, `min-w-[22rem]` floor, `truncate` + `max-w` on the Team
   cell (with `title` so the full name stays reachable), `tabular-nums` on the
   numerics.
2. **Scoring page header row could not wrap.** `flex items-center justify-between`
   with up to four children (title, offline-queued badge, over counter, End Innings)
   and no `flex-wrap` — guaranteed collision on a 320–375px phone, i.e. the device
   scorers actually use. Now `flex-wrap` + `gap`, with the trailing controls in their
   own wrapping group.
3. **Touch targets were 40px, not the 44px this plan sets as the goal (5.4).**
   `min-h-10 min-w-10` on Undo/Redo/End-Innings → `min-h-11 min-w-11` (44px).
   Passes WCAG 2.2 AA either way; this closes the gap against the stated target and
   Apple HIG. The primary ball pad was already 56px.

Also routed the "End Innings" failure through `resolveActionError` so a plan-limit
error shows an upgrade path instead of the raw wire payload in a toast — the same
inconsistency fixed earlier for team/player creation.

### False positives, deliberately not "fixed"

- `user-list-table.tsx` / `registration-list.tsx` matched a `<table` scan but use the
  UI library's `<Table>` component, which supplies its own overflow container.
- `fantasy_points_rules` in the §0.5 audit — intentionally world-readable.
- Dashboard points table and leaderboard tables (3–6 narrow/`truncate`d columns) fit
  without a scroll wrapper.

**Method note:** no blanket restyling was done. Every change above is a specific
defect with a reason; the audit's main output is the list of things that are *not*
broken.

---

## 0.7 Chunk 2.4 — match intro/summary commentary (Oct 7 2026)

The plan described 2.4 as "trigger `generateMatchIntro`/`generateMatchSummary`".
Inspection showed **two** independent breaks, and only one of them was the trigger.
Fixing only the trigger would have produced a system that spends an OpenAI call and
throws the result away.

### Break 1 — no producer

`kafka-scoring-publisher.service.ts` published **only** to `ssl.scoring.ball-events`.
Nothing anywhere emitted to `ssl.match.events`, which is the topic
`CommentaryController.handleMatchEvent` subscribes to. Both generation methods were
therefore **unreachable dead code**.

Added `MATCH_EVENTS_TOPIC`, a `MatchEventPayload` / `MatchEventType` contract, and
`publishMatchEvent()`, then wired the two real transitions in `scoring.service.ts`:

- `scheduled -> live` (first ball of an innings) → `MatchStarted`
- `completeMatch` → `MatchEnded`

Both fire-and-forget **after commit**, matching the existing ball-event rule: Kafka
being down must never roll back a committed score. `publishMatchEvent` swallows and
logs failures for the same reason.

Two details that matter:
- `MatchStarted` is emitted only on the genuine transition, via a `becameLive` flag
  captured in the transaction — otherwise every ball would fire an intro.
- `completeMatch` is idempotent, so it now records `wasAlreadyComplete` and emits
  `MatchEnded` only on the real transition. Without this, a retried request or a
  double-click generated a second summary.
- The deterministic `idempotency-key` is `${matchId}:${type}` so a redelivery carries
  the same key.

### Break 2 — the result was discarded even with a producer

`handleMatchEvent` **returned** the generated string to Kafka, where nothing read it.
`ssl.commentary` → `CommentaryBridgeController` → WebSocket `commentary-update` is the
working delivery path, and it was bypassed. Routed intro/summary through that existing
topic rather than inventing a second channel.

This required distinguishing lifecycle commentary from ball commentary, so
`Commentary` gained `kind?: 'ball' | 'intro' | 'summary'`. `ballId` stays a required
`string` (empty for intro/summary) so existing consumers keep compiling.

### A dedup bug this surfaced on the frontend

`commentary-store.addEntry` deduplicated on `ballId + timestamp`. With `ballId` empty
for both intro and summary, one would suppress the other on a timestamp collision.
Identity is now `kind:ballId:timestamp`, defaulting `kind` to `"ball"` so payloads
published before the field existed still dedupe. 8 new tests, including the
intro-vs-summary collision as an explicit regression case.

### Documented limitation, not hidden

`publishMatchCommentary` copies one generated English string into both `english` and
`urdu` so the consumer contract holds and the UI's language switcher keeps working.
It is **not** a translation. Real per-language intros need one generation per
language, which multiplies cost — a product decision, not a silent default.

Verification: 7/7 packages type-check, 66 web tests (8 new), 26 scoring, 21
commentary, 40 database. Still unverified: the live Kafka round-trip, which needs a
running broker and a scoring request — no Clerk session exists yet.

---

## 1. Phase 1 — Public Pages & Live Streaming

| # | Task | Status |
|---|------|--------|
| 1.1 | `matches`: `liveStreamUrl`, `streamSource`, `streamStatus`, `scorerId` | **Done** — migration `20261004090000` |
| 1.2 | `/matches/[id]` public scorecard | **Done**, now tenant-scoped |
| 1.3 | `/matches/[id]/live` public live page | **Done**, now tenant-scoped |
| 1.4 | Facebook / YouTube embeds + `StreamSelector` | **Done** — `components/live/` |
| 1.5 | "Start Live Stream" modal | **Done** — `stream-start-modal.tsx` |
| 1.6 | WS score overlay on live page | **Done** — `useScoringSocket` |
| 1.7 | `/tournaments/[id]` + `/leaderboards` | **Done**, tournament page now tenant-scoped |
| 1.8 | Middleware: `/matches/(.*)` public except `/scoring` | **Done** — `middleware.ts:120` re-protects scoring |
| 1.9 | OG image + share buttons | **Done**, OG route now tenant-scoped |
| 1.10 | Persist streams | **Not a defect** — the service `Map`s hold ephemeral mediasoup/WebRTC runtime state, which is correct. Durable state lives in `matches.stream_status`. See §0.3 |

## 2. Phase 2 — AI Commentary Bridge + Scoring Completion

| # | Task | Status |
|---|------|--------|
| 2.1 | Kafka `ssl.commentary` consumer → WS `commentary-update` | **Done** — `commentary-bridge.controller.ts` |
| 2.2 | `CommentaryFeed` + `LanguageSelector` | **Done** — scoring page *and* live page via `LiveOverlay` |
| 2.3 | "End Innings" button | **Done** — now proxies to scoring-service |
| 2.4 | Trigger `generateMatchIntro`/`generateMatchSummary` on match events | **Done** — Oct 7; see §0.7 for what was actually missing |
| 2.5 | Partnerships / fall-of-wickets / extras breakdown | **Done** — public scorecard page |
| 2.6 | PDF scorecard export | **Open** |
| 2.7 | Web scoring actions proxy to scoring-service | **Done** — Oct 6 |

## 3. Phase 3 — OTP, Notifications, User Flows

| # | Task | Status |
|---|------|--------|
| 3.1 | `verification_tokens` table + migration | **Done** |
| 3.2 | OTP send/verify routes | **Done** |
| 3.3 | PIN input UI | **Done** — `OtpInput`, `OtpVerification` |
| 3.4 | Notification bell + `/dashboard/notifications` | **Done** — now tenant-scoped |
| 3.5 | Notification WS/SSE bridge | **Open** — no WS in notification-service |
| 3.6 | Scorer assignment | **Done** — `scorer-assign.tsx` |
| 3.7 | Team manager invite flow | **Done** — now atomic on redemption |
| 3.8 | Player ID card generator | **Done** — advisory lock added |
| 3.9 | Fan reactions | **Done** |
| 3.10 | Notification/streaming port collision | **Done** — 4008 vs 5005 |

## 4. Phase 4 — Subscription Engine

| # | Task | Status |
|---|------|--------|
| 4.1 | Shared `checkPlanLimit()` guard | **Done** — `lib/plan-guard.ts`; structured `PlanLimitError` drives upgrade prompts |
| 4.2 | Block live stream on `liveStreaming:false` | **Done** |
| 4.3 | Subscription countdown + status derivation | **Done** — `subscription-countdown.tsx` |
| 4.4 | "Renew Now" modal | **Done** — `api/billing/stripe/checkout` |
| 4.5 | Cron `/api/cron/subscription-renewal` | **Done** — registered in `vercel.json`, hardened |
| 4.6 | 14-day Pro trial + banner | **Open** — `trialEndsAt` still unset at signup |
| 4.7 | Persist payment-service (kill in-memory `Map`) | **Not a defect** — already persists to the `payments` table. See §0.3 |
| 4.8 | PDF invoice on activation | **Open** |
| 4.9 | Usage meters | **Done** — `usage-meters.tsx` |

## 5. Phase 5 — Premium UI/UX + Mobile

5.1 Landing polish · 5.2 Mobile bottom nav · 5.3 Responsive tables · 5.4 Touch
targets · 5.5 PWA · 5.6 Offline scoring (mobile has a queue; **web does not**) ·
5.7 Scoring animations · 5.8 Comparison radar · 5.9 Bracket viz · 5.10 Team
analytics · 5.11 Public leaderboards (**done**) · 5.12 Dashboard widgets ·
5.13 Mobile live view · 5.14 Stripe checkout.

## 6. Phase 6 — Super Admin Hardening + Launch

All `/admin/*` routes live in **`apps/admin`**, not `apps/web`.

| # | Task | Status |
|---|------|--------|
| 6.1 | `/users` data grid | **Done** — `users-management.tsx`, `users-grid.tsx` |
| 6.2 | `/subscriptions` page + lifecycle API | **Done** |
| 6.3 | `/audit-logs` viewer + API | **Done** |
| 6.4 | `/live-streams` monitor | **Done** |
| 6.5 | Impersonation banner + exit flow | **Done** — `impersonation-banner.tsx` |
| 6.6 | Renewal intervention tab | **Done** |
| 6.7 | E2E: OTP, scoring lifecycle, live stream, renewal | **Partially done** — all 4 specs restored + 3 type bugs fixed; **never executed**. Blocked on Clerk auth, not on data (see §0.4) |
| 6.8 | Load test WS + streaming; Sentry; deploy | **Open** |

---

## Remaining build order

Re-derived after §0.3, §0.4, the tenant-isolation pass and 4.1. The original top
two items were non-issues; the security/correctness gaps that were real are now
closed, and the biggest one was a live lockout that only became visible once there
was data to look at.

1. ~~**`scoring-service` tenant authorization**~~ — done
2. ~~**4.1** shared `checkPlanLimit()`~~ — done, incl. upgrade-prompt UX
3. ~~**Seed data**~~ — done (`supabase/seed.sql`), and it surfaced a live bug
4. ~~**Responsiveness (5.3/5.4)**~~ — done, full 170-file scan, 3 real defects fixed
5. ~~**2.4** match intro/summary commentary~~ — done; both breaks fixed
6. **Clerk auth wiring** — now the real blocker. No user has a `clerk_id`, so no
   browser session can exist and 6.7 cannot run. Set `users.clerk_id` for at least
   the seeded users, or drive E2E with a fixture token.
7. 4.6 trial, 2.6 PDF export, 3.5 notification WS, then Phase 5 polish (landing,
   bottom nav, animations, bracket viz)
8. `pg_trgm`/`btree_gin` out of `public` — cosmetic; deferred deliberately because
   moving a schema that GIN indexes depend on risks breaking queries for a lint

No known data-loss bug remains, and tenant isolation is now verified against live
RLS rather than assumed.

## Corrections to the original plan — do not build against these

- `/admin/*` are in `apps/admin`, not `apps/web`. Do not "add" them to web.
- `/revenue`, `/commission`, `/feature-flags`, `/white-label` exist.
- Web match routes use `[matchId]`, not `[id]`; `/tournaments` uses `[id]`.
  The inconsistency is real but harmless — do not assume `[id]`.
- `withAuth` lives in `src/app/actions/action-guard.ts`, **not** `src/lib/`.
- OTP, commentary, public pages and notification UI exist. Do not rebuild them.
- Payment "in-memory" loss is in `services/payment-service`. **Correction: there is
  no in-memory loss there** — it already persists to `payments`. See §0.3.
- Scoring SoT is settled: `services/scoring-service` owns all scoring writes.
  Do not add direct-DB scoring actions. Be aware the service itself does not
  authorize by tenant — it trusts the caller (§0.3).
- Do not add `/admin/*` to `apps/web`, and do not run `supabase db push` /
  `db reset` — see `supabase/MIGRATION_STATUS.md`.
- No edge functions exist in this project. Do not "deploy" them.
