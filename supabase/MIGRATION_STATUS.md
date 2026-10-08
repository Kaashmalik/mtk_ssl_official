# Migration Status & Drift Notes

> Written after the Oct 6 hardening pass. Read before running `supabase db push`,
> `db reset`, or adding a migration.

## Verdict: schema is in sync

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