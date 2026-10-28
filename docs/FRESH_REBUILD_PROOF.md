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

## Freshness ledger (Batch 176, 2026-10-28) — re-proof owed

The PASS above describes the folder AS OF Batch 157 (2026-10-19): 80 files.
The folder has grown since; **this document has NOT re-run the drill** and the
PASS does not extend to the additions. Honesty over narrative:

- `supabase/migrations` now contains **97** `.sql` files (lexicographic order
  unchanged — every filename keeps the `YYYYMMDDHHMMSS_` prefix).
- The **19** files below carry dates on/after the proof's cut and are
  UNPROVEN by the Batch 157 drill:

```
20261019000000_match_group_label.sql
20261019010000_match_forfeit_postponed.sql
20261019100000_invitation_email_jobs.sql
20261019110000_account_locale_preferences.sql
20261019120000_notification_email_preference.sql
20261019130000_notification_push_preference.sql
20261019140000_fan_predictions.sql
20261019150000_tournament_application_replies.sql
20261019160000_drop_users_tenant_ids.sql
20261020100000_normalize_tenant_membership_platform_roles.sql
20261020120000_league_application_replies.sql
20261021120000_notification_reads.sql
20261021130000_notification_jobs.sql
20261021140000_media_assets.sql
20261021150000_broadcast_provider.sql
20261022120000_scoring_wicket_attribution.sql
20261026120000_admin_action_approvals.sql
20261026130000_match_chat.sql
20261027120000_match_chat_retention.sql
```

- Notes for the re-run: one later file DROPS a column
  (`20261019…_drop_users_tenant_ids.sql`, ISO-06). A fresh container should
  still rebuild without error because the drop targets a column created
  earlier in the same folder — but note the drill's method ("apply the whole
  folder to a virgin database") never exercises in-place upgrades; it proves
  fresh rebuilds only, which is exactly what it has always claimed.
- Re-proof: `node scripts/base04-fresh-rebuild.cjs` on a Docker-enabled
  machine, update the method/count/result above, then delete this ledger.
  Until then the PASS claims exactly 80 files — no more.
