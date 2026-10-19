# Fresh Rebuild Proof — BASE-04 (Batch 157, 2026-10-19)

**Result: PASS.** All 80 migration files apply, in lexicographic order,
to a virgin PostgreSQL 15 database using nothing but the folder
`supabase/migrations` plus a minimal documented prelude.

## Method (reproducible)

1. Throwaway container: `postgres:15-alpine`, isolated port.
2. PRELUDE (applied before migrations; the only non-folder SQL):
   - Supabase platform roles the grants expect: `anon`, `authenticated`,
     `service_role`, `ssl` (all NOLOGIN).
   - `auth` schema with NULL-STUB functions `auth.uid()`,
     `auth.role()`, `auth.jwt()` so the 28 `auth.uid()` and 9
     `auth.jwt()` policy references parse. On a stub, RLS predicates
     evaluate to NULL → **deny by default**, which is the safe
     direction; on hosted Supabase the platform supplies the real
     request context.
3. Each of the 80 files piped whole to `psql -v ON_ERROR_STOP=1`
   (the same shape a migration CLI uses). Dollar-quoted `$$` plpgsql
   bodies require whole-file execution — a naive statement splitter
   corrupts them (attempt 1 failed 80/80 on exactly that; attempt 2
   with per-file piping passed 80/80).
4. Failures, if any, are recorded per file and the run continues to
   surface the complete blocker list.

## Result

| Check | Value |
|---|---|
| Migrations applied | 80 / 80, 0 failed |
| Tables in `public` | 70 |
| Tables with RLS enabled | 70 (all) |
| Policies | 138 |
| Enums | 43 |
| Functions | 145 |

## Interpretation

- The folder rebuilds a complete, fully RLS-covered schema from
  nothing. A fresh local/staging database is provable on demand and
  does not depend on the live database's history.
- The deployed database's LEDGER (supabase_migrations) is a separate
  concern from schema reality — see Batch 156: stamps differ between
  the CLI ledger and folder for 7 batches (name-aware reconcile), and
  manual remote-applies are now ledgered verification-first. One
  deliberate exception remains: `20261017130000` (league_applications)
  belongs to Session B under the parallel-session boundary.
- v1's 80/80 failure is retained as evidence that rebuild tooling
  MUST use dollar-quote-aware execution; the proven splitter lives in
  the batch-apply scripts, and per-file piping removes the class of
  bug entirely.

## Reproduction

`rebuild-proof.cjs` (session scratch, `rebuild-proof-output2.txt` and
`rebuild-result.json` capture the run): spin up the container, apply
the prelude, apply every migration file whole with ON_ERROR_STOP,
collect the catalog sanity counts, tear the container down.
