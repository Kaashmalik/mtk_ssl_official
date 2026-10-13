# Migration Status & Drift Notes

> Written after the Oct 6 hardening pass. Read before running `supabase db push`,
> `db reset`, or adding a migration.

> **12 October 2026 update:** the inventory below is a historical October 6–7
> snapshot, not a live schema certification. The new
> `20261012100136_league_membership_controls.sql` is **local and unapplied**;
> follow the Batch 7 rollout gates below before releasing its dependent code.

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
