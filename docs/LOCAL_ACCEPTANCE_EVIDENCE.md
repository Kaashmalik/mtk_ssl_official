# Local acceptance evidence — Batches 156–158 (2026-10-19)

Three previously paper-only acceptance items were EXECUTED for real on
2026-10-19, against dockerized throwaway databases. Everything below
was produced by committed, repeatable scripts; nothing is claimed
beyond what actually ran.

## What was executed

| Item | Tool | Result |
|---|---|---|
| BASE-04 fresh rebuild | `scripts/base04-fresh-rebuild.cjs` | PASS — 80/80 migrations, fresh `postgres:15-alpine`, 70 tables / 70 RLS / 138 policies / 43 enums / 145 functions (`docs/FRESH_REBUILD_PROOF.md`) |
| REL-01 two-league RLS isolation | `scripts/rel01-rls-isolation.cjs` | **NO VIOLATIONS** — see matrix below |
| REL-05 backup → restore drill | `scripts/rel05-restore-drill.cjs` | **PASS** — remote `pg_dump` (0.5 MB, in-memory pipe only) restored into a virgin `postgres:17-alpine`; every core table's row count matches the remote |

## REL-01 method (honest scoping)

- Fresh-rebuild container with a Supabase-shaped prelude: platform
  roles + JWT-GUC-reading stubs (`auth.uid()` reads
  `request.jwt.claim.sub`, hosted parity) + hosted-parity table
  grants + `service_role` BYPASSRLS. The prelude is a DOCUMENTED
  platform-parity decision, not a schema change; without it the RLS
  predicates parse but cannot be exercised.
- Two full leagues seeded atomically (users, tenants,
  user_tenant_roles, teams, tournaments, matches, profiles, players)
  with explicit ids so the JWT `sub` claims match real rows. Seeding
  cooperates with the `20261004240000` owner-membership trigger
  (upsert on `(user_id, tenant_id)`).
- Exercise: `SET LOCAL ROLE authenticated` +
  `SET LOCAL request.jwt.claim.sub = <member>` per check.
- Note: migration `024` revoked PUBLIC grants, so under the folder
  alone every platform-role read is *permission denied* (isolation by
  grant). The hosted-parity grant layer was added to exercise the RLS
  *predicates* on top. Both layers were observed to deny cross-tenant
  rows.

## REL-01 matrix (cross-tenant reads MUST be 0)

| Table | member A sees | A sees B's rows | B sees A's rows | anon | service_role | Verdict |
|---|---|---|---|---|---|---|
| user_tenant_roles | 1 (own) | 0 | 0 | 0 | 3 (incl. seed super-admin) | ISOLATED |
| teams | 2 (own league) | 0 | 0 | 0 | 4 | ISOLATED |
| tournaments | 1 | 0 | 0 | 0 | 2 | ISOLATED |
| matches | 1 | 0 | 0 | 0 | 2 | ISOLATED |
| players | 1 | 0 | 0 | 0 | 2 | ISOLATED |
| tenants (global) | — | member A sees tenant B: 0 | — | — | — | ISOLATED |
| profiles (global) | — | member A sees B's profile: 0 | — | — | — | ISOLATED |

Constraint-level: a second SUBMITTED league application for the same
(tournament, team) is REFUSED by the partial unique index itself
(B147) — `ENFORCED by database`.

`audit_logs` is NOT tenant-bearing (nullable `tenant_id`); tenant
isolation is not its guarantee (it is audit provenance) — reported
honestly, not exercised.

## REL-05 method

- Remote: `PostgreSQL 17.6`, 17 MB, 64 tables (supabase pooler).
- `pg_dump` client 17 matches the server; `--no-owner
  --no-privileges`; the dump streams caller-memory only and its
  scratch file lives for one psql call before deletion. PII never
  lands on disk.
- Verification compares counts per table; a table absent on BOTH
  sides is recorded as faithful absence, not an error.
- `matches_check` (`team_a_id <> team_b_id`), the owner-membership
  trigger and partial-unique indexes all survived restore intact —
  constraints are part of the backup story as much as rows are.

## Real findings this work surfaced (not hidden)

1. **REG-01 (`league_applications`) is NOT deployed remotely** — the
   REL-05 existence check found the table missing on the live
   database (consistent with the one remaining ledger drift in the
   Batch 156 `--db` gate). Session B owns applying + ledgering it.
2. **Remote DB is young**: 1 user / 1 tenant, all traffic tables 0
   rows — counts matching therefore prove restore fidelity of
   structure + constraints more than of data volume; the drill is
   repeatable and worth re-running as data grows.
3. **Tooling lesson (kept in evidence)**: naive semicolon-splitters
   shred dollar-quoted plpgsql bodies; whole-file `psql
   ON_ERROR_STOP` execution (CLI shape) is the correct rebuild path.
4. **Grant layering**: folder migrations intentionally rely on the
   hosted platform's grant policy (migration 024 revokes PUBLIC);
   a bare-pg rebuild must choose — deny-by-default (safe) or hosted
   parity (exercisable RLS). The prelude makes that choice explicit
   and reviewable.

## Reproduction

```sh
node scripts/base04-fresh-rebuild.cjs --user-guc   # KEEP=1 to keep the container
node scripts/rel01-rls-isolation.cjs               # needs the kept container
node scripts/rel05-restore-drill.cjs               # needs DATABASE_URL
```

## What remains live-gated after this (honest)

- REL-02 browser/E2E journeys, REL-03 socket fan-out under load,
  REL-04 storage/uploads, REL-06 providers/emails: real devices,
  staging infrastructure and provider keys.
- REL-05's owner-side half (secret rotation, lost-account recovery)
  needs owner participation.
- SCORE-14, UX-04 device journeys, BASE-05/06 sandboxes, SCORE-08
  approved mobile identity, REL-07 owner approvals.
