# Migration Status & Drift Notes

> Written after the Oct 6 hardening pass. Read before running `supabase db push`,
> `db reset`, or adding a migration.

> **15 October 2026 (evening) — FULL REBUILD & RECONCILIATION COMPLETE.**
> The database was wiped from the SQL editor (schema and data dropped, migration
> history left stale), then **rebuilt from the repository's canonical chain**:
> all migrations `001` → `20261013180000` were applied in filename order, plus
> two new reconciliation migrations created by this pass (see below). The
> sections below the horizontal rule are historical and describe the era **before**
> this rebuild; their "unapplied" statements no longer hold.

### Batch 65 bounded memberships (16 October 2026)

`20261016120000_membership_expiry_delegation.sql` is a **local migration only**,
not applied anywhere. It adds nullable `expires_at` and `delegated_by_user_id`
(ON DELETE SET NULL provenance) to `user_tenant_roles`, a chronological CHECK,
and a partial index; RLS, grants and existing rows are unchanged and the
migration is additive/idempotent. Enforcement is application-level (shared
membership-effectiveness policy + canonical scoring boundary + web admin);
database-level RLS/serializability acceptance of expiry races still requires a
real disposable database. No remote database was queried or written; Batch 62's
release-evidence requirements remain unmet.

### Batch 64 idempotent consumers (16 October 2026)

Source-only change; no schema, migration, RLS/grant or database-data change.
Commentary consumers and the scoring bridge now use Redis SET NX claims keyed by
the stable outbox event identity to deduplicate at-least-once redelivery, with
fail-open behavior (surfaced) on Redis outages and claim release on processing
failure. Claims are caches, not authorization: the bridge's forwards still pass
the publication/league boundary recheck, and no endpoint grants access by claim
possession. No migration was applied anywhere; no remote database was queried or
written, and Batch 62's release-evidence requirements remain unmet.

### Batch 63 scoring transactional outbox (16 October 2026)

`20261016102316_scoring_transactional_outbox.sql` is a **local migration only**,
not applied anywhere. It adds an internal `scoring_outbox` delivery journal and a
`matches_id_tenant_key` unique index (composite `(id, tenant_id)` FK target for
the journal). All privileges are revoked from `PUBLIC`/`anon`/`authenticated`
with grants only for `service_role`/`ssl`, RLS enabled and forced, and no DELETE
grant anywhere — pending rows are retained, not purged. Schema tests assert the
Drizzle definition and SQL file agree on FK parentage, dedupe identity, envelope
CHECKs, grants and additive/atomic structure. The migration chain has not been
executed against any real PostgreSQL database from this session; real apply,
rollback and RLS acceptance remain open. No remote database was queried or
written; release evidence requirements from Batch 62 are unchanged and unmet.

### Batch 62 release evidence and separate schema acceptance (16 October 2026)

Production deployment no longer invokes `drizzle-kit migrate` against the canonical
Supabase SQL files or suppresses a migration failure before printing success. A reviewed
schema rollout is separate; candidate-bound real-Postgres migration-chain evidence is
required by the new default-off release checker, along with isolation/concurrency and
other retained acceptance. No schema, migration history, grants or data were queried or
changed. Accessible MCP projects could not be linked unambiguously to this repository;
no unrelated project's database was inspected. Local Docker/PostgreSQL remain absent.
Historical rebuild evidence below was not re-certified; no acceptance/approval claimed.

### Batch 61 canonical public live-read boundary (16 October 2026)

Canonical public snapshot/history reads now use exact-league publication/active-league
checks in the same repeatable-read read-only transaction as their data. History verifies
the innings hierarchy and uses an explicit field allowlist; Redis does not authorize
publication. Socket/commentary/reaction forwarding rechecks the boundary and uses scoped
rooms. Custom-domain web public resolution now applies the active-league predicate too.
No schema/migration, RLS/grant, remote database operation, build or deployment ran.
These application tests do not certify deployed RLS, race/withdrawal behavior, cross-node
room eviction, provider delivery or browser acceptance. The historical rebuild remains
historical evidence only; the release gate stays default-off.

### Batch 60 registered-squad validation (16 October 2026)

Canonical scoring now reads/locks existing `league_registrations` rows with exact
tenant/tournament/team predicates, deterministic order and a three-row corruption
bound. Shared code validates approved declared squads and rejects known non-approved
registration states; the web selector/readiness model agrees. No schema, migration,
RLS/grant, remote database inspection/write or deployment change occurred. Existing
row locks do not serialize absent-row inserts; real two-session status/squad races,
legacy fallback migration and rollback behavior still need disposable-DB acceptance.
The historical rebuild evidence below is unchanged and was not revalidated here.

### Batch 59 source-quality gate (16 October 2026)

Web TypeScript checking now passes without the historical error baseline. This batch
changes page signatures, test-adapter typing/imports and pure voice-input normalization;
no schema/migration, database operation, RLS/grant or deployment change occurred. A green
type check does not independently validate the historical rebuild or release isolation.

### Batch 58 application-only member directory (16 October 2026)

Owner-only member readers add literal name/email search, league role/access filters,
membership-ID keyset pagination and exact-membership detail reads. Every read retains
an exact tenant predicate and a bounded explicit field projection; no new public API
or private-contact permission is granted. No schema/migration, database inspection/write,
RLS/grant, provider or deployment change ran. Real PostgreSQL query plans, isolation,
concurrent changes between pages and authenticated browser journeys remain unverified.

### Batch 57 application-only leaderboard qualification (16 October 2026)

Published league leaderboards now apply user-selected minimum innings/balls to the
same grouped season-stat rows via aggregate `HAVING`, before ordering and the top-10
limit. Tenant/publication predicates are retained. No schema, migration, RLS/grants,
remote database inspection/write, or deployment ran. Format-specific records are not
claimed: existing season aggregates have no match-format dimension. Real PostgreSQL
aggregate/plan verification and public-browser acceptance remain open.

### Batch 56 application-only follow-up (16 October 2026)

Member assignment reads now detect and disclose capped results rather than implying
that omitted assignments do not exist. They remain exact-league, account-filtered,
bounded application reads with resource-ID ordering. The member removal writer,
its locks, version checks, assignment guards and audit behavior are unchanged.
No database inspection, write, migration application, RLS/grant change or deployment
was performed in this batch. The rebuild evidence below is historical; it was not
independently revalidated by this source-only work. Real-DB and browser acceptance
remain required, and the release gate stays default-off.

### Rebuild summary (15 October 2026)

| Check | Result |
|---|---|
| Migrations applied (all, in order) | 45 = 43 repo files + `025`, `026` below |
| Drizzle tables defined | 50 |
| Tables present in `public` | **50 — exact match** |
| Missing tables / columns / enums vs Drizzle | **0 / 0 / 0** |
| RLS enabled | 56 policies-checked tables → **all** public tables enabled |
| Legacy DB-only tables | **0** — the 6 documented tables were dropped (no code readers, no view deps, empty) |
| Advisors (security / performance) | **0 findings** |
| Recorded migration history | rewritten to exactly the 45 repo filename prefixes — `db push` now reports **no drift** |
| Super admin | `kaash0542@gmail.com` (`role='super_admin'`, active) — DB row and `005_seed_super_admin.sql` both updated |
| `auth.users` | **empty** — create the Supabase Auth user `kaash0542@gmail.com` (invite) so login works; `is_super_admin()`/`current_tenant_id()` match by email fallback |

### Bugs fixed in repository migrations during the rebuild

1. **`001_enable_uuid_v7_and_helpers.sql` — `uuid_generate_v7()` was doubly
   broken**: `integer & bit` (bit-string literals `x'0F'` etc.) aborted every
   `INSERT`, and the `decode()` input used the 16-char zero-padded timestamp
   (36 hex = 18 bytes) instead of the 12-char `unix_ts_ms`, so `::uuid` would
   also fail. Rewritten: 12-hex 48-bit ms timestamp + integer masks, producing
   valid, time-ordered v7 UUIDs. (`all_migrations_combined.sql` patched too.)
2. `009_fantasy_cricket.sql` — default `fantasy_points_rules` rows referenced a
   phantom all-zero tenant (FK violation on a fresh DB). Now seeded only when
   that tenant exists. The app never reads this table.
3. `018_create_impersonation_sessions.sql` — grants assumed a custom `ssl` role
   (existed only on the pre-wipe project). A guarded `CREATE ROLE ssl NOLOGIN`
   block now runs before first use (used by 8 later migrations).
4. `022_add_starter_plan_and_payment_tables.sql` — `ALTER TYPE tenant_plan` ran
   unconditionally (type is a fresh-install legacy artifact; now guarded), and
   two policies referenced `users.clerk_id` (Clerk era). They now use
   `users.id = auth.uid()`, matching the Supabase-Auth design of `001`'s helpers.
5. `024_revoke_sensitive_table_grants.sql` — hardening ran before
   `20260623_add_user_tenant_roles.sql` creates the table; `REVOKE`/`GRANT`/
   `COMMENT`/`DROP POLICY ... ON user_tenant_roles` and the policy-creation
   block are now `to_regclass`-guarded, and the file is re-applied at the end of
   the chain (final hardening pass).
6. `20260623_add_user_tenant_roles.sql` — backfill joined
   `users.clerk_id = tenants.owner_id::text`; now joins `users.id = owner_id`.

### New migrations created by this pass

- **`025_sync_drizzle_schema.sql`** — adds application columns no earlier
  migration creates: `users(clerk_id, display_name, avatar_url, last_login_at)`,
  `teams(short_name, description, city, banner_url, primary_color,
  secondary_color, founded_year, max_squad_size, created_by)`,
  `matches(total_overs, man_of_match_id, umpire_1, umpire_2, third_umpire,
  match_referee, created_by)`, with `users_clerk_id_key` unique index. Idempotent.
- **`026_align_app_types.sql`** — creates the 11 enums the 001–024 chain never
  created (`user_role`, `tenant_plan`, `match_format`, `match_type`,
  `match_status`, `toss_decision`, `wicket_type`, `innings_status`,
  `tournament_format`, `tournament_status`, `ground_type`; `stream_source`/
  `stream_status` stay owned by `20261004090000`), drops legacy text CHECK
  constraints (the enums now own those domains — e.g. the old
  `users_role_check` permitted only `user/admin/super_admin`, not even `fan`),
  and converts the live columns to the Drizzle-declared enum types
  (`users.role`, `tenants.plan`, `matches.{match_format,match_type,status,
  toss_decision}`, `match_innings.status`, `match_balls.wicket_type`,
  `tournaments.{format,status}`, `venues.ground_type`), recreating the two
  super-admin policies on `subscription_requests` around the `users.role` change.

### Bookkeeping notes

- `all_migrations_combined.sql` was **regenerated** from the 45 migration files
  (the previous copy dated 2026-05-25 predated 18 migrations and carried the
  broken `uuid_generate_v7()` body).
- `combined_pending_migrations.sql` was **removed** — it was a stale generated
  bundle of not-yet-applied migrations; nothing is pending anymore.
- Recorded history rows were rewritten with `created_by = 'mcp'` and no
  `statements` payload, so the CLI matches by version prefix; re-running
  `supabase db push` is expected to be a no-op.
- `seed.sql` was **not** applied (batch environment kept the database clean of
  fixture rows; run it deliberately when fixture data is wanted — it is
  idempotent, uses `.invalid` emails, per the historical notes below).

### Still true (unchanged)

- **No edge functions exist in the repository** (`supabase/functions` is
  absent); there is nothing to deploy on that front.
- `LEAGUE_MEMBERSHIP_CONTROLS_READY` stays unset/false until the *real-DB
  acceptance* gates are exercised (two-session races, RLS, grants, staging
  acceptance). The rebuild proves the schema was applied; it does **not**
  certify runtime behavior. Gates below still stand as written.

---

## Historical verdict (October 6–7): schema was in sync

| Check | Result |
|---|---|
| Drizzle tables defined | 49 |
| Tables present in `public` | 55 |
| **Drizzle tables missing from the database** | **0** |
| Tables in DB but absent from Drizzle | 6 (legacy, see below) |

The last gap was `user_tenant_roles` — defined in the Drizzle schema and read by
`rbac-server.ts` on every tenant-scoped permission check, but never created in
the database. Closed by `20261004210000_create_user_tenant_roles.sql`.

## Trap 1: repo filenames do not match recorded versions

Migrations applied through the Supabase MCP `apply_migration` tool are recorded
under a **tool-generated version**, not the filename's timestamp prefix:

| Repo filename | Recorded in `supabase_migrations` |
|---|---|
| `20261004200000_harden_public_surface_privileges` | `20261006192804` |
| `20261004210000_create_user_tenant_roles` | `20261006192834` |
| `20261004220000_revoke_invoice_fn_from_anon` | `20261006192905` |
| `20261004230000_authoritative_tenant_roles_remove_superadmin_backdoor` | `20261006193705` |
| `20261004240000_ensure_tenant_owner_has_role` | `20261007021xxx` (tool-generated) |
| `20261004250000_fix_matview_trigger_definer` | `20261007022xxx` (tool-generated) |

**Consequence:** the CLI compares the numeric prefix of each repo filename against
`supabase_migrations.versions`. These six will read as *pending* and be replayed.

**This is currently survivable** because all six are written idempotently
(`IF NOT EXISTS`, `DROP ... IF EXISTS`, `CREATE OR REPLACE FUNCTION`,
`ON CONFLICT DO NOTHING`), so a replay is a no-op rather than an error. Verify that
property holds before adding a migration that is not idempotent.

## Trap 3: a trigger can silently break an RLS-granted write

`player_season_stats` grants `FOR ALL` to `authenticated`, but the
`trigger_refresh_player_all_time_stats` trigger called an invoker-rights function
that could not `REFRESH MATERIALIZED VIEW`. The policy advertised a write that the
database then refused. Fixed in `20261004250000`.

**When auditing RLS, always include a control case that *should* succeed.** The
tenant-isolation policies all looked correct; only attempting an allowed write
revealed the trigger. A read-only audit cannot find this class of bug.

Related: `refresh_player_all_time_stats()` rebuilds the whole matview per writing
statement. See the migration header before extending it.

## Trap 2: the legacy 001–0xx files were renamed after being applied

The database records `001_uuid_helpers`, `002_enums`, `003_core_tables`,
`004_rls_policies`, … while the repo contains `001_enable_uuid_v7_and_helpers.sql`,
`002_create_tables.sql`, `003_create_rls_policies.sql`, …

The numeric prefixes happen to line up, but the **names differ**, so name-based
comparison also reports them as pending.

**Do not run `supabase db push` or `db reset` against this project** without first
reconciling, and never run `db reset` against a database that holds data — it
drops and replays everything.

For a fresh, disposable database, replaying `supabase/migrations/*.sql` in
filename order is correct.

## Legacy tables (in DB, not in Drizzle)

`ai_commentary`, `ball_events`, `live_scorecards`, `notification_preferences`,
`player_statistics`, `tournament_standings`

These exist only from raw SQL migrations. The app cannot reach them through
Drizzle. They are candidates for either a schema definition or removal — but
confirm nothing reads them via raw SQL first.

## Data state — corrected Oct 7 2026

An earlier version of this file claimed the database was empty. **That was wrong.**
It already held real data. Verified contents before the seed was applied:

| Table | Pre-existing rows | Notes |
|---|---|---|
| `tenants` | 2 | `ssl` = "Shakir Super League" (**enterprise**) — the real league; `system-default` sentinel with an all-zero `owner_id` |
| `users` | 2 | `kaash0542@gmail.com` (`role = 'super_admin'`), `kashif@maliktech.pk` (`role = 'fan'`) |
| `tenant_branding` | 1 | branding for `ssl` |
| `commission_rates` | 4 | reference data |
| `fantasy_points_rules` | 11 | reference data |
| everything else | 0 | |

### Consequences that were previously stated wrongly

- `kaash0542@gmail.com` **already** holds `role = 'super_admin'`. Removing the
  hardcoded-email backdoor in
  `20261004230000_...remove_superadmin_backdoor.sql` therefore locked **nobody**
  out; no manual `UPDATE` grant was needed. Verified by calling `is_super_admin()`
  under a simulated session.
- The Playwright specs are **not** blocked by missing data. They are blocked
  because **no user has a `clerk_id`**, so Clerk cannot authenticate anyone and no
  browser session can exist.

### Live bug this exposed: locked-out tenant owner

`tenants.owner_id` and `user_tenant_roles` were independent sources of truth.
`current_tenant_id()` reads the junction table, so a tenant whose `owner_id` had
no role row produced an owner locked out of their own league — every RLS policy
evaluated the tenant to `{}` and denied. Live on `ssl`:

```
owner_id -> kashif@maliktech.pk
users.role = 'fan', users.tenant_ids = '{}', user_tenant_roles = 0 rows
=> current_tenant_id() = '{}' => sees nothing in the league they own
```

Fixed by `20261004240000_ensure_tenant_owner_has_role.sql`: idempotent backfill plus
a trigger on `INSERT` / `UPDATE OF owner_id`. It only **adds** a missing row
(`ON CONFLICT DO NOTHING`) and never modifies or demotes an existing role.
Placeholder owners (all-zero sentinel) are skipped — they have no `users` row and
the FK would reject the insert. `EXECUTE` on the function is revoked from
`PUBLIC`/`anon`/`authenticated`, since it is `SECURITY DEFINER`.

## Seed data

`supabase/seed.sql` — idempotent (fixed UUIDs + `ON CONFLICT DO NOTHING`),
safe to re-run. Applied via `execute_sql`, deliberately **not** `apply_migration`,
so seed rows never enter migration history.

Fixture emails use the reserved `.invalid` TLD (RFC 2606) and carry **no**
  `clerk_id`, so they cannot authenticate and cannot be confused with real users.

It seeds three extra tenants (free / starter / pro) plus a live match whose innings
aggregates are **derived from** its ball rows, and deliberately places
`lahore-lions` at exactly `free.maxTeams` (4) and `free.maxPlayers` (40) so the
quota boundary can be exercised.

## Batch 7 rollout gates — unapplied membership controls (12 October 2026)

`20261012100136_league_membership_controls.sql` is a **local migration only**.
Its SQL/schema contract tests do not prove database execution. Docker is absent
in the development environment; no Supabase reset, remote migration, authentication
change or deployment was performed for this batch.

### Before applying or releasing

1. Reconcile recorded migration versions with repository filenames using the
   drift notes above. Inspect the actual tables, enum, indexes, triggers, function
   definitions/owners and role grants. Do not blindly run `db push`, `db reset`,
   repair migration history or regenerate a production schema from Drizzle.
2. Review users, global account activity, tenant owners, legacy arrays and every
   existing explicit role. The backfill preserves existing rows and adds absent
   referenced memberships; it cannot distinguish historical revocations from an
   obsolete legacy array. Approve the proposed additions before execution.
   Global owner/admin roles are not blindly copied to unrelated leagues.
3. Resolve existing `super_admin` membership rows and anomalous owner mappings.
   Such platform membership rows are denied by the new operational guards;
   ordinary member CRUD cannot repair them. Preserve at least one authorized
   active owner per active league through a reviewed administrative procedure.
4. Audit direct Data API consumers (especially mobile), table **and column**
   grants, inherited privileges and RLS policies. The migration revokes direct
   account/member mutations for `anon`/`authenticated`; an inherited or separate
   column-level grant must not bypass the trusted command path. Privileged server
   connections bypass RLS and still need application authorization.
5. Review the existing `auth.uid()`/JWT-email identity bridge and trusted function
   ownership. This migration does not map Clerk string subjects to application
   UUIDs or certify recipient identity. Do not enable client Data API access on
   the assumption that this batch implements third-party authentication.
6. Take a verified backup and execute the migration on a disposable, appropriately
   anonymized staging database first. It is intentionally not a rerunnable SQL
   script: new columns/function/trigger creation must match recorded history.
   Confirm active/suspended constraints, version increments from every writer,
   backfill results and empty tenant scope for absent/suspended memberships.
7. Exercise real two-session locking/concurrency, stale-version rejection, audit
   rollback on failure, revoked scoring record/replay/undo/innings/match completion,
   invitation suspension rejection and RLS permissions. Confirm no deadlocks in
   existing writers and no direct account/role privilege escalation.
8. Exercise authenticated browser/mobile journeys: Ali active/assigned in A,
   suspended in B, absent in C; unchanged global account/other-league records;
   retained rejected offline work; owner protection; primary-versus-host tenant
   behavior; save failure/conflict, dialog and keyboard/responsive behavior.

### Coordinated release and rollback

- Keep repository VPS deployment disabled (leave
  `LEAGUE_MEMBERSHIP_CONTROLS_READY` unset/false). Inspect external hosting Git
  integrations separately; this repository gate does not control them.
- After the above gates pass, arrange a controlled maintenance window. Apply the
  reviewed migration once and verify schema/history/owners/grants. Deploy matching
  database/UI workspace artifacts, web and scoring service together; confirm the
  matching server-only `SCORING_SERVICE_TOKEN` configuration and reload stale
  clients. Old member action signatures intentionally do not remain privileged.
- Enable `LEAGUE_MEMBERSHIP_CONTROLS_READY=true` only after migration acceptance
  and coordinated release readiness. The existing VPS script's warning-only
  Drizzle migration step is **not** proof this Supabase SQL was applied. Record
  the deployed migration version, application SHAs and acceptance evidence here.
- Do not roll back to binaries that ignore membership status while treating
  suspended users as revoked. Disable sensitive traffic or deploy a reviewed
  forward fix; do not delete suspension/audit records or restore legacy fallback
  as an access-recovery shortcut. A database rollback requires its own reviewed
  backup/restore procedure, not an automatic down migration.

**Still open:** all real-database/deployed acceptance, complete provider-verified
OTP and delivery lifecycle, expiry/scoped multiple grants, delegated
resource-scoped grants and privileged MFA (ownership transfer itself is now
source-complete in Batch 12, pending real-DB proof), unknown/removed host
handling and complete private CRUD/socket/export coverage.

## Batch 9 migration — invitation dispatch state (13 October 2026)

`20261013090000_invitation_delivery_state.sql` is a **local migration only**, not
applied. It adds three additive columns to `user_invites`:

| Column | Purpose |
|---|---|
| `email_state` | Last recorded dispatch outcome (`unconfigured`/`provider_accepted`/`failed`/`unknown`); provider acceptance is not delivery |
| `email_attempted_at` | Instant of the last attempt; drives the resend cooldown |
| `email_attempt_count` | Attempt counter (create + resends) |

Unlike the Batch 7 migration this one **is** idempotent
(`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before re-adding the
check), so a replay is a no-op. It is nevertheless subject to the same rollout
rules: reconcile history, back up, apply on a disposable staging database first,
then release the matching web artifact. It changes no grants or RLS policies and
does not alter existing rows. The dependency is purely additive — code that omits
the new columns keeps working, so the migration can be applied ahead of the web
deploy without breaking the previous binary.

## Batch 10 migration — backup scorer (13 October 2026)

`20261013120000_match_backup_scorer.sql` is a **local migration only**, not
applied. It adds `matches.backup_scorer_id` (nullable `uuid` FK to `users`,
`ON DELETE SET NULL`), a `matches_backup_scorer_distinct_check` constraint that
forbids the same person in both scorer slots, and an index on the new column.

Additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`
before re-adding, `CREATE INDEX IF NOT EXISTS`), so a replay is a no-op. It changes
no grants or RLS policies and does not alter existing rows. The check constraint
only rejects rows where both slots are set to the same user; existing matches have
`backup_scorer_id = NULL`, so the constraint validates immediately without a
backfill. Apply ahead of the web deploy is safe — a binary that omits the column
keeps working.

## Batch 11 migration — invitation delivery events (13 October 2026)

`20261013150000_invitation_delivery_events.sql` is a **local migration only**, not
applied. It widens `user_invites_email_state_check` to also permit `delivered`,
`bounced` and `complained`, which are written only from the signature-verified
Resend webhook.

Idempotent (`DROP CONSTRAINT IF EXISTS` before re-adding) and additive: it does
not touch rows, grants or policies, and it only **relaxes** the constraint, so
existing values still validate and a binary that never writes the new states keeps
working. Apply ahead of the web deploy is safe. Operational note: the webhook
route fails closed (503) until `RESEND_WEBHOOK_SECRET` is configured, so an
unconfigured deployment simply records no delivery events.

## Batch 12 migration — two-party ownership transfer (13 October 2026)

`20261013180000_ownership_transfers.sql` is a **local migration only**, not
applied. It creates the `ownership_transfers` table (one row per ownership
handover) with its status/`from_user_id <> to_user_id`/version/`demoted_role`
check constraints, a partial unique index
(`WHERE status = 'pending'`) that allows at most one open request per league, a
recipient lookup index, and RLS.

Additive and idempotent (`CREATE TABLE IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS` before re-adding, `CREATE INDEX IF NOT EXISTS`), so a
replay is a no-op. It creates a new table and does not alter `tenants`,
`user_tenant_roles` or any existing row, so it is safe to apply ahead of the web
deploy — a binary that never writes this table keeps working. Access control
follows the `user_invites` precedent: RLS is enabled and forced, all access is
revoked from `anon`/`authenticated`, and only `service_role` (and the `ssl`
role where present) is granted. Application writes go through server actions
that run as the service role.

Operational note: nothing enforces the handover invariant except the Batch 12
application transaction plus this table's constraints. The `tenants.owner_id`
re-point, the recipient promotion and the outgoing-owner demotion all occur in
one transaction, so the migration must be applied together with (or before) the
web code that depends on it.

## Batch 13 integration review (13 October 2026)

No new migration was created or applied. The canonical scoring writer now
recognizes `matches.backup_scorer_id` after current membership/account/league
authorization; web dashboard shortcuts and member-removal checks also include
the backup slot. The Batch 10 schema migration is a prerequisite for the release.

All five previous local migrations remain unapplied here. Do not enable the VPS
release gate based only on passing mocked tests. Deploy matching database
workspace artifacts, web and scoring service together after actual schema/grant
and staging verification. Assignment/removal races, real writer handover/fencing
and ownership-resolution authorization findings recorded in the Batch 13 roadmap
entry remain open; no remote state was inspected or certified by this batch.

## Batch 14 ownership authorization (15 October 2026)

No new migration, remote database inspection or database write occurred. The
Batch 12 application transaction now rechecks current account/session mappings,
both active acceptance accounts and recipient privilege drift under ordered
locks; cancellation reauthorizes the caller's current access. Exact-tenant
conditional resolution writes include status/version/party predicates. Final
acceptance uses `expires_at > clock_timestamp()` so transaction-start time does
not extend consent; issuance expiry cleanup also checks the database wall clock.

The Batch 13 ownership source findings have fixes, but real PostgreSQL lock,
clock, rollback, accept/cancel races and RLS acceptance remain unverified. All
five previous migrations remain unapplied here; the deployment gate stays
default-off. Assignment/removal concurrency and writer fencing remain open.

## Batch 15 assignment/removal serialization (15 October 2026)

No new migration, remote database inspection/write or deployment occurred.
Scorer assignment now locks exact-tenant match -> sorted accounts -> league ->
sorted memberships, rechecks current authority and writes its before/after audit
in one READ COMMITTED transaction. Membership removal uses READ COMMITTED and
non-locking assignment checks after its shared account locks. Do not add a match
lock after those accounts: that would invert assignment/scoring's lock order.
Generic match metadata edits reject scorer-slot fields so they cannot bypass
this application protocol. Team-manager assignment races are outside this fix.

Source and scheduling-double regressions close the recorded source gap, not
the real PostgreSQL acceptance gate. Repeat both two-session assignment/removal
orders for both slots, opposite-slot conflicts, account/membership revocation,
scoring/unassignment and audit rollback on a reconciled local/staging schema.
All five prior migrations remain unapplied; the deployment gate stays default-
off. Pending-member assignments, stale-operator CAS and writer fencing remain open.

## Batch 16 lifecycle and session authorization (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. Toss/start use an exact-league READ COMMITTED transaction
with match -> account -> league -> membership -> sorted-team locks, current
assignment/session checks and atomic audits. Member role/status/removal commands
also compare the current locked Clerk mapping; role/status isolation is explicit.

Web end-match writes now proxy to canonical completion. The service validates
optional Player of the Match against an exact-league match-team player and
atomically audits result/award changes using the existing `man_of_match_id` and
`audit_logs` schema. Deploy matching web/service code and workspace artifacts;
old service code would ignore the optional award. Verify scoring-service audit
INSERT grants, real audit rollback, revocation/completion races and replay in
staging. Tests are mocked; no actual PostgreSQL behavior is certified here.

All five prior migrations remain unapplied; the deployment gate remains
default-off. Broader match CRUD/read/stream context, historical deletion policy,
team-manager races and reliable lifecycle event fan-out remain open.

## Batch 17 match management and active-league reads (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. Match metadata/cancel/stream commands now use READ
COMMITTED with existing match -> actor -> league -> membership -> sorted-team
-> tournament -> venue locks as needed, current owner/session checks and atomic
audits. Creation inserts a new match, without locking an existing match after
the actor. Reads/pickers and dashboard auxiliaries are explicitly tenant-scoped.

`deleteMatch` now cancels an unstarted scheduled fixture instead of hard-deleting
and cascading. It refuses lifecycle/scoring evidence, including legacy manual
scorecards; the row and assignments are retained. This is not a database-wide
history guarantee: existing team/player cascades and non-participating manual
scorecard writers remain to be audited. Reconcile those writers and lock order
before certifying concurrent edit/cancel/scoring/resource-delete behavior.

All five prior migrations remain unapplied and the release gate stays default-
off. Verify actual grants, audit INSERT/rollback, schema compatibility, real
two-session races, history-query performance/indexes and RLS in staging. Mocked
tests do not establish these database properties or deployed lifecycle fan-out.

## Batch 18 scorecard hierarchy and roster archival (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. The unused manual `saveScorecard` action is now a denied
compatibility stub, not a second direct scorecard writer. Existing rows remain;
there is no replacement manual import/correction endpoint. Full/innings scorecard
reads validate the current league and parent hierarchy, including correlated
innings scope for full batting/bowling reads.

Team/player deletion wrappers now perform owner-authorized archival using
READ COMMITTED and account -> league -> membership -> team -> player locks.
Player team-link drift is rejected after locks. Unfinished fixtures are checked
with plain reads after resources, never match locks that would reverse the
canonical scoring order. Team/player flags and archive audits are atomic;
identities, roster links and historical score data are not deleted. Other/admin
deletion paths and non-participating writers remain outside this guarantee.

All five prior migrations remain unapplied and the release gate stays default-
off. Verify real grants/audit rollback/RLS, hierarchy query execution/indexes,
and two-session archive/create/scoring/revocation acceptance before rollout.
Mocked call-order/SQL/render tests do not establish those database properties.
Archive is not a restore/purge/quota-release workflow; existing lists/quotas can
retain archived records. No broader team/player CRUD certification is claimed.

## Batch 19 — team/player and roster writer protocol (15 October 2026)

No new migration, remote SQL operation or deployment. `createTeam`, `updateTeam`,
`createPlayer`, `updatePlayer` and add/remove roster actions now use exact-active-
league READ COMMITTED transactions with current account/Clerk/membership and
owner/assigned-manager checks. Lock account -> league -> membership -> sorted
teams -> player. Both creates take an exclusive league lock before reading the
current plan/count and inserting; other operations share the league lock. Team
locks serialize participating roster joins and squad-capacity changes; player
team drift is rejected after locking. All records, including archived rows,
still consume quota/capacity. This is not a database-wide constraint.

Current toss/live/innings-break reads after resource locks block roster team/
status eligibility amendments during play; they do not take match locks after
accounts/resources. Scheduled fixtures remain amendable under this roster rule.
Audit/row writes are atomic; audits omit contact/profile/DOB values. Identity,
membership and historical score rows are not deleted. This adds no immutable XI,
restore, quota release, direct transfer, CAS or alternate scoring writer.

All five prior migrations remain unapplied; release gate stays default-off.
Before rollout, verify real two-session create limits, join/capacity races, player
team drift, roster versus toss/start/scoring/archive/revocation, deadlocks and
audit-failure rollback. Inspect actual grants, query plans, constraints and RLS;
mocked SQL/count/call-order tests do not prove these properties. Other/admin
writers and tournament/venue cascade paths still require protocol review.
Team/player read actions and core dashboard routes now use exact-active-league
context, scoped joins, explicit field projections, bounded pickers and current-
authority controls. Ordinary reads exclude contact/DOB/physical/biography/global
identity/creator fields; owner-only edit reads separate private profile data.
Team summaries use scoped database-side counts rather than per-row queries.
Archived rows remain historical; no restore/purge/quota release is introduced.
These are request-local authorization/projection checks, not read-versus-
revocation locks or database-wide privacy constraints. Team analytics and player
ID-card list/detail routes also now resolve the exact active league and tenant-
filter every child query.

All five prior migrations remain unapplied; release gate stays default-off.
Before rollout, verify real RLS/grants, scoped query plans/indexes, picker/list
performance and concurrent read/write behavior. Inspect actual constraints and
RLS; mocked SQL/projection/call-order tests do not prove these properties. Team
analytics, player ID-card list/detail paths were scoped in the Batch 20 follow-up;
the tournament delete path is now an archival (Batch 22) and fan-follow
mutations/reads are scoped to the exact active league and account UUID (Batch 23);
remaining tournament lifecycle/list/detail writers, venue/admin writers and
public/anonymous follow/publication paths remain the next source slice.

Registration review writers (create/approve/reject/withdraw/confirm-fee) now use
exact-active-league READ COMMITTED transactions with current account/Clerk/
membership and league checks. Lock order is account -> league -> membership ->
tournament -> team -> registration; tournament locks always precede registration
locks so approval cannot deadlock a concurrent registration. Approval locks the
tournament row and re-checks `maxTeams` capacity before linking the team; fee
confirmation inserts the payment and flips the fee state atomically. Creation
verifies a same-league active team, an open window/status, active tenant-scoped
squad members, the team squad limit and `(team, tournament)` uniqueness. Audits
omit squad lists, notes, fee references and account UUIDs; no refunds, slot
release, waitlist, restore or quota release is added. Review reads use explicit
projections (no payment reference or registered-by/approved-by UUIDs) and bounded
pages.

Tournament removal is now a locked, audited cancel/archival instead of a hard
delete. `deleteTournament` resolves the exact active league, checks
`tournament:delete` and, under READ COMMITTED, locks account -> league ->
membership -> tournament, re-checks the owner after the wait, refuses `live` and
already-archived tournaments and sets status `cancelled` with registration closed.
It never cascades: registrations, team links and match links are preserved (the
prior FK `DELETE`/`SET NULL` behaviour no longer runs) and it takes no match locks.
This is not a purge, refund, slot-release or restore workflow.

This is still not a database-wide constraint. Verify real two-session
create/approve capacity races, tournament/registration and tournament/archive
lock ordering, cascade absence, fee/status CAS and audit-failure rollback, plus
actual grants, query plans and RLS; mocked call-order tests do not prove these
properties.

Fan-follow writes/reads now resolve the exact active league, require the
`fan:follow` permission on an active membership, map the Clerk identity to the
account UUID and assert the target entity exists in that league; the client tenant
must equal the active league. This fixes a bug where the Clerk string was stored/
matched against the `fan_follows.user_id` UUID column, so team/player follow state
always read false. Inserts are idempotent via the `(userId, type, id)` unique index
(`onConflictDoNothing`); counts/state/list are tenant-scoped. This is not yet a
public/anonymous or cross-league follow experience and adds no owner-review audit,
rate limit or notification fan-out. Verify real RLS, the unique constraint, grants,
indexes and two-session follow races.

## Batch 24 — stats and scoring dashboard read scope (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `dashboard/stats`, `dashboard/stats/compare` and
`dashboard/scoring` no longer use the primary-membership fallback (`getMyTenant`)
or redirect to league setup on an authorization failure. A new
`lib/league-reads.ts` resolves the exact active league, checks `stats:read` (both
stats routes) or `match:read` (scoring console) via `requirePermissionServer`,
maps Clerk → active account, then requires an active same-league membership whose
role holds the permission plus an active `tenants` row. A global role, tenant array
or primary membership never grants access.

Leaderboard reads inner-join `players` and `teams` with the same active-league
predicate as the scorecard filter, group by player, are bounded (1–50) with a
deterministic tiebreak and let query failures propagate instead of rendering an
empty board. The comparison roster is league-scoped and bounded (1–200);
`readPlayerComparison` scopes the player and every batting/bowling/fielding child
read to the active league and rejects a non-UUID id before SQL (previously the
child scorecard reads filtered by `playerId` only). The scoring console filters
and bounds matches (100 rows, +1 fetch to flag truncation) with SQL ordering and
resolves team names with a league-scoped `inArray` instead of an unscoped batch
lookup.

All five prior migrations remain unapplied; release gate stays default-off. These
are request-local authorization and projection checks — not read-versus-revocation
locks, database RLS or a public/anonymous experience. They are not certified for
export, cache or socket scoping. Before rollout, verify real RLS/grants and scoped
query plans/indexes on these read paths; mocked SQL/call-order and render tests do
not prove those database properties. Next source slice: remaining tournament
lifecycle/list/detail writers and venue/admin writers, then public/anonymous
follow, publication and notification boundaries.

## Batch 25 — tournament dashboard read scope (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. The tournament dashboard list and creator no longer use the
primary-membership fallback (`getMyTenant`) or redirect to league setup on an
authorization failure. A new `lib/tournament-reads.ts` provides
`readTournamentList(tenantId)`, and the Batch 24 context helper is renamed
`requireActiveLeagueContext` for reuse as a page-level gate. The list resolves the
exact active league with `tournament:read`, the creator with `tournament:create`;
both reject a global role, tenant array or primary membership.

The list is bounded (200 rows, +1 fetch to flag truncation) and orders
deterministically. Registered-team and match counts are aggregated with grouped
queries that carry the same tenant predicate as the list, so a foreign team or match
link cannot inflate a tournament's totals; the previous whole-league N+1 reads ran
child counts by `tournamentId` only. Resolution and query failures now propagate
instead of being swallowed into a fake empty list. The creator no longer receives a
primary-membership `tenantId` (it was unused; the create action resolves the league
server-side).

All five prior migrations remain unapplied; release gate stays default-off. These
are request-local authorization/projection checks — not database RLS, read-versus-
revocation locks or a public/anonymous experience, and not certified for export or
cache scoping. Before rollout, verify real RLS/grants and index support for the
grouped count queries; mocked SQL/call-order and render tests do not prove those
database properties. Next source slice: remaining tournament registration lifecycle
writers and venue/admin writers, then public/anonymous follow, publication and
notification boundaries.

## Batch 26 — locked tournament registration lifecycle (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `openRegistration`/`closeRegistration` no longer call
`tournamentRepo.updateById`; a new `setTournamentRegistration` in
`lib/tournament-lifecycle.ts` performs the write in a READ COMMITTED transaction that
locks account → league → membership → tournament, rechecks the current owner after
the wait and writes an atomic minimal audit
(`TOURNAMENT_REGISTRATION_OPEN`/`TOURNAMENT_REGISTRATION_CLOSE`). The action wrappers
validate the id shape before the transaction.

Guards: an archived (`cancelled`) tournament can neither open nor close
registration; registration only opens for a `draft`/`registration` tournament
(refusing `live`/`completed`); closing keeps the current status and only clears
`registrationOpen`. The audit row and the status write share the transaction, so a
failing audit aborts the update. The permission gate (`tournament:manage_registrations`)
runs before the transaction and the owner role is rechecked under the lock. This is
not a purge, refund, slot-release or restore workflow.

All five prior migrations remain unapplied; release gate stays default-off. Before
rollout, verify real two-session open/close ordering against archive and registration
writes, audit rollback, lock deadlock freedom and RLS; mocked call-order/SQL tests do
not prove those database properties. Next source slice: remaining tournament
create/update writers and venue/admin writers, then public/anonymous follow,
publication and notification boundaries.

## Batch 27 — locked, audited tournament create/update (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `createTournament`/`updateTournament` no longer call
`tournamentRepo.insert`/`updateWithLock`; a new `lib/tournament-writes.ts` performs
both in READ COMMITTED transactions that lock account → league → membership (and, for
update, the tournament row), recheck the current owner after the wait and write an
atomic minimal audit (`TOURNAMENT_CREATE`/`TOURNAMENT_UPDATE`). It shares
`lockOwnerContext` with the Batch 26 lifecycle writers, so all tournament writers use
one lock order.

Per-league unique slug: create and a renamed slug pre-check a `(tenant_id, slug)`
duplicate and map a PostgreSQL unique-violation (`23505`) race to the same friendly
error instead of a raw 500 — the unique constraint added by
`uniqueTenantSlug: UNIQUE (tenant_id, slug)` is the real guarantee. The update write
keeps the existing locked date/seed-order validation and legacy-rules preservation
inside its `prepare` callback. `persistenceValues` is now generic so a create input
keeps its required `name`/`format` through validation.

All five prior migrations remain unapplied; release gate stays default-off. Before
rollout, verify real two-session create/update/archive/registration lock ordering,
unique-index behaviour under concurrency, audit rollback, lock deadlock freedom and
RLS; mocked call-order/SQL tests do not prove those database properties. Next source
slice: remaining venue writers, settings/billing and other dashboard destinations,
then public/anonymous follow, publication and notification boundaries.

## Batch 28 — exact-league settings, billing and invoices (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. The settings, billing, invoices and invoice-detail pages no
longer resolve the league inline with `getMyTenant` + `getUserRoleForTenant` and
silently redirect to the dashboard on denial; they use the shared fail-closed
`requireActiveLeagueContext("settings:manage")` gate and read through new
`lib/league-settings-reads.ts`, which predicates every query on the resolved
`tenantId` and returns explicit projections (identity/branding, bounded invoice
history, a single invoice, bounded white-label requests). A missing/inactive league
or an insufficient role throws to the error boundary rather than redirecting.
`lib/invoices.ts` is removed (its `getMyInvoices` returned `[]` when no tenant was
found); the white-label writer shares the same active-league resolution and its
unused read action is replaced by the scoped reader. Note `getMyTenant` was already
membership-verified and request-tenant-first, so this is a protocol/fail-closed/
projection change rather than a cross-tenant fix.

This tightens `TEN-*`/`ISO-04` application-level scoping but does not change any RLS
policy or grant: these reads run as the application connection, so real isolation
still depends on the deployed policies and grants in the five unapplied migrations
(notably `20261012100136_league_membership_controls.sql`). All five prior migrations
remain unapplied; release gate stays default-off. Before rollout, verify real
per-tenant `tenant_branding`, `invoices` and `white_label_requests` visibility under
RLS and grants, and cross-league denial for a multi-league account; mocked readers do
not prove those database properties. Next source slice: tournament-detail
mutation-control gating and the remaining venue writers, then public/anonymous follow,
publication and notification boundaries.

## Batch 29 — permission-gated tournament-detail controls (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `dashboard/tournaments/[id]/page.tsx` now resolves the exact
active league with `requireActiveLeagueContext("tournament:read")`, 404s a tournament
whose `tenantId` is not that league, and renders each mutation control only for a role
that holds its permission: edit (`tournament:update`), archive (`tournament:delete`),
registration open/close (`tournament:manage_registrations`) and the self-service
registration CTA (`registration:create`). The controls were previously rendered for
every viewer whose role held `tournament:read`, so a fan/player/coach/scorer (and a
team manager, for the league-administration controls) saw buttons whose actions then
denied. The underlying actions are unchanged and still re-check on write. This entry
also corrects the Batch 28 notes: `getMyTenant` was already membership-verified and
request-tenant-first, so Batch 28 was a protocol/fail-closed/projection change rather
than a cross-tenant fix.

This is application-level control-visibility alignment; it does not change any RLS
policy or grant, and per-role page rendering under a mocked context is not proof of
authenticated-browser or database-level authorization. All five prior migrations remain
unapplied; release gate stays default-off. Before rollout, verify page rendering and
action denial for each role against the deployed policies and grants. Next source
slice: the remaining venue writers and the registrations/new swallow-and-redirect, then
public/anonymous follow, publication and notification boundaries.

## Batch 30 — self-service registration form resolves the active league (15 October 2026)

No schema change, migration application, remote database inspection/write or deployment
occurred. `dashboard/registrations/new/page.tsx` no longer wraps the team, tournament and
player list actions in a `try/catch` that redirected to `/dashboard/league/setup` (even on
an authorization denial) and rendered empty pickers; it now resolves the exact active
league with `requireRegistrationReadContext("registration:create")` and reads bounded,
tenant-scoped pickers through the new `readRegistrationFormOptions(tenantId)` in
`lib/registration-reads.ts` (over-fetch 101/101/201, truncate to 100/100/200; teams
narrowed to `isActive`). An anonymous visit goes to `/`, and read or authorization
failures propagate to the error boundary instead of a silent redirect or an empty form.

This is an application-level read-scoping change; it does not change any RLS policy or
grant, and a mocked reader/database is not proof of authenticated-browser or
database-level authorization. All five prior migrations remain unapplied; release gate
stays default-off. Before rollout, verify each picker returns only the active league's
rows under the deployed policies and grants. Next source slice: the remaining venue
writers, then public/anonymous follow, publication and notification boundaries.

## Batch 31 — league venue (grounds/facilities) management (15 October 2026)

No schema change, migration application, remote database inspection/write or deployment
occurred. The existing `venues` table is now administered from the dashboard. RBAC adds
`venue:read` (every league role) and `venue:manage` (`super_admin`, `league_owner`), and the
sidebar/header expose a gated **Venues** item. `lib/venue-reads.ts` reads the exact active
league only — a bounded list (over-fetch 201, truncate to 200), a single venue and
active-venue options (over-fetch 201, truncate to 200) — rejecting a `super_admin`
membership and never falling back to an owned/default tenant. `lib/venue-writes.ts` creates,
updates and archives/restores a venue in one `read committed` transaction that locks account
→ league → membership → the venue row, rechecks the current authority after the wait, and
writes its audit in the same transaction; the per-league `UNIQUE(tenantId, name)` is
surfaced as one friendly error (pre-check plus `23505`). Archiving toggles `isActive` and
never deletes, because `matches.venueId` is `ON DELETE SET NULL`, so historical match links
survive.

This is an application-level scoping and write-path change; it does not change any RLS
policy or grant, and a mocked reader/database is not proof of PostgreSQL locking,
unique-constraint behavior or authenticated-browser/database-level authorization. All five
prior migrations remain unapplied; release gate stays default-off.

**Verification:** web 2,031 / 63 files, database 128 / 8 files, scoring service 193 / 8
suites; 2,352 passing tests (+38 over Batch 30). `tsc --noEmit` still reports only its
pre-existing unrelated errors. Before rollout, verify the venue readers return only the
active league's rows under the deployed policies and grants, and exercise the archive/restore
compare-and-set and duplicate-name mapping against real PostgreSQL. Next source slice: the
remaining catch-redirect cleanups, then public/anonymous follow, publication and notification
boundaries.

## Batch 32 — registration review queue reports access/read failures (15 October 2026)

No schema change, migration application, remote database inspection/write or deployment
occurred. `app/dashboard/registrations/page.tsx` previously wrapped
`requireRegistrationReadContext("registration:manage")` in a `try/catch` that redirected to
`/dashboard` on **any** error, so a tenant/membership/database failure looked like an ordinary
non-owner visit. It now calls the new non-throwing `resolveRegistrationReviewAccess()` in
`lib/registration-reads.ts`: this returns the review context only when the viewer holds
`registration:manage` in the exact active league, and `null` when they are not a league owner
(no active league, no active membership, a `super_admin`-only membership, or a missing
permission). Tenant, actor, membership and league lookups are not swallowed, so an
infrastructure failure throws and reaches the route's `error.tsx`. The queue read
(`readRegistrations`) was already uncaught.

This is an application-level failure-propagation change; it does not change any RLS policy or
grant, and a mocked reader/database is not proof of authenticated-browser or database-level
authorization. All five prior migrations remain unapplied; release gate stays default-off.

**Verification:** web 2,037 / 64 files, database 128 / 8 files, scoring service 193 / 8
suites; 2,358 passing tests (+6 over Batch 31). `tsc --noEmit` still reports only its
pre-existing unrelated errors. Before rollout, verify the review-queue access decision and its
error boundary against real PostgreSQL and an authenticated browser. Next source slice:
public/anonymous follow, publication and notification boundaries.

