-- Harden public-surface database exposure.
--
-- Findings came from `supabase_get_advisors` against the live project
-- (security advisor) plus direct inspection of pg_proc / pg_class. Only the
-- issues that are actually exploitable from an unauthenticated or
-- authenticated-but-untrusted PostgREST client are addressed here; see the
-- notes on each item for the ones deliberately left alone.
--
-- Context: this application never reads these tables through PostgREST. All
-- access is server-side via the service_role connection string, which bypasses
-- RLS and holds full table grants. So revoking anon/authenticated privileges
-- breaks nothing, and leaving them granted only widens the public API surface.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Materialized view readable by anon — CROSS-TENANT LEAK
--
-- `player_all_time_stats` is a materialized view. Postgres cannot apply RLS to
-- a materialized view, so the only possible control is table-level privileges.
-- The advisor reported it as selectable by anon and authenticated; inspection
-- confirmed 0 policies (meaningless for a matview) and that the definition
-- projects `tenant_id` alongside per-player aggregates:
--
--     SELECT tenant_id, player_id, sum(runs_scored), ... FROM player_season_stats
--     GROUP BY tenant_id, player_id;
--
-- Effect before this change: `GET /rest/v1/player_all_time_stats` with no
-- credentials returns every tenant's player_id -> statistics mapping. That is a
-- direct violation of the tenant-isolation model the rest of the codebase
-- enforces, and it enumerates both other tenants and their player rosters.
--
-- Fix: revoke from anon and authenticated; keep service_role (which the Nest
-- services use) fully privileged. The public leaderboards UI reads through a
-- server component, not PostgREST, so it is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.player_all_time_stats FROM anon;
REVOKE ALL ON public.player_all_time_stats FROM authenticated;
GRANT  ALL ON public.player_all_time_stats TO service_role;

-- Belt-and-braces: an explicit deny view is NOT used here because revoking the
-- privilege is the correct fix. A `security_invoker` view over the matview is
-- also not possible — RLS does not apply to the underlying matview either.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `next_invoice_number()` callable by anon — SEQUENCE BURN
--
-- `EXECUTE` is granted to PUBLIC by default in Postgres, which is why the
-- advisor/inspection show anon_exec = true. Both overloads return
-- `nextval('public.ssl_invoice_seq')`, so ANY unauthenticated caller can
-- advance the shared invoice sequence by invoking the function repeatedly
-- through `/rest/v1/rpc/next_invoice_number`. Consequences: invoice numbers are
-- no longer gapless, a tenant can be pushed to a very large invoice number, and
-- the sequence burns toward exhaustion without any real invoice.
--
-- Fix: revoke EXECUTE from PUBLIC (and therefore from anon/authenticated).
-- The service calls this as service_role, so it keeps working.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_invoice_number(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `SECURITY DEFINER` helpers reachable over PostgREST RPC — NOT CHANGED
--
-- The advisor recommends revoking EXECUTE on `current_tenant_id()`,
-- `current_user_id()`, `is_super_admin()` and `user_belongs_to_tenant(uuid)`
-- from `authenticated`. DO NOT DO THAT: it would break tenant isolation
-- project-wide.
--
-- RLS policy expressions are evaluated with the privileges of the role running
-- the query, and function EXECUTE is checked against that same role.
-- SECURITY DEFINER changes what the function *body* runs as, not who must be
-- granted EXECUTE. Revoking EXECUTE from `authenticated` therefore makes every
-- policy calling these helpers raise "permission denied for function".
--
-- Verified affected policies (queried from pg_policies):
--   tenants.tenants_access, tournaments.tournaments_tenant, teams.teams_tenant,
--   subscriptions.super_admin_all_subscriptions,
--   subscriptions.tenant_read_subscriptions, payments.super_admin_all_payments,
--   announcements.*, feature_flags.*, system_health.*, error_logs.*,
--   players.players_tenant, venues.venues_tenant, ...
--
-- That would be a total RLS outage for every authenticated read.
--
-- The exposure the advisor describes is also mostly not real:
--   * `anon_exec` is already false for all four — unauthenticated callers
--     cannot reach them at all.
--   * The three zero-argument helpers only echo the caller's own JWT claims,
--     which they already hold.
--   * `user_belongs_to_tenant(uuid)` is a genuine membership-enumeration
--     oracle, but it is deliberately reachable: the tenant switcher relies on it
--     to decide which tenants to offer a signed-in user. Removing it removes a
--     product feature.
--
-- Mitigation that does NOT break policies: keep EXECUTE for `authenticated` and
-- rely on these functions only ever returning data about the *caller*. If the
-- enumeration oracle is later judged unacceptable, fix it server-side (the Nest
-- layer already has `resolveActiveTenantId` / `requireTenantContext`) rather
-- than revoking a privilege RLS depends on.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `apply_scoring_event()` reported as "callable by anon" — NOT EXPLOITABLE
--
-- It is a TRIGGER function (`RETURNS trigger`). PostgREST's rpc endpoint cannot
-- invoke trigger functions, so anon_exec = true is inert. No trigger or policy
-- references it. No privilege change is warranted; the search_path pin in
-- section 5 is still worthwhile hardening.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Mutable `search_path` on nine functions
--
-- All nine were reported by the advisor and confirmed to have `proconfig = NULL`.
--
-- IMPORTANT correction to the advisory's framing: every one of these is
-- SECURITY INVOKER (`prosecdef = false`), not SECURITY DEFINER. Pinning
-- search_path is therefore defence-in-depth against object shadowing rather
-- than a fix for an active privilege-escalation path — these functions run with
-- the caller's own privileges. It is still worth doing: an unpinned
-- search_path lets anyone who can create objects in a schema on the path
-- substitute a different table or function.
--
-- Signatures are taken from the catalog via `oid::regprocedure` rather than
-- hand-written. Two of these functions are overloaded, and
-- `calculate_player_stats` takes (p_player_id uuid, p_tenant_id uuid) — a
-- hardcoded zero-arg ALTER FUNCTION would have errored and aborted the entire
-- migration. Selecting `oid::regprocedure` also skips anything already pinned.
--
-- The four functions discussed in section 3 were also reported by the advisor
-- but already pin `search_path = public, pg_catalog, auth`. Not touched — that
-- advisory hit was a false positive for them.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    -- Schema-qualified because `oid::regprocedure` renders an UNQUALIFIED name
    -- when the function happens to be visible on the current search_path. Relying
    -- on that would make the ALTER fail under a different search_path.
    SELECT format('%I.%s', n.nspname, p.oid::regprocedure) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proconfig IS NULL
      AND p.proname IN (
        'update_live_scorecard',
        'calculate_player_stats',
        'update_waitlist_updated_at',
        'apply_scoring_event',
        'refresh_player_all_time_stats',
        'expire_old_subscription_requests',
        'cleanup_verification_tokens',
        'next_invoice_number'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', r.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Deliberately NOT changed
-- ─────────────────────────────────────────────────────────────────────────────
-- * `apply_scoring_event()` reported as "callable by anon": it is a TRIGGER
--   function (`RETURNS trigger`). PostgREST cannot invoke trigger functions via
--   rpc, so this is not exploitable and no privilege change is warranted.
--   Its search_path is still pinned above, which is worthwhile hardening.
--
-- * `invoices`, `user_invites`, `verification_tokens` reported as "RLS enabled,
--   no policies" (INFO): this is the correct fail-closed state for tables only
--   ever accessed as service_role. Adding permissive policies would make these
--   directly reachable from a browser and would be a regression, not a fix.
--
-- * `pg_trgm` and `btree_gin` installed in `public` (advisor WARN): moving an
--   extension between schemas can break dependent operators/classes and is not
--   an isolation risk. Worth doing as separate maintenance, not in a hardening
--   migration.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run after applying):
--
--   -- 1. expect false for both: matview is no longer public
--   select has_table_privilege('anon','public.player_all_time_stats','SELECT') as anon_matview;
--   select has_table_privilege('authenticated','public.player_all_time_stats','SELECT') as authed_matview;
--
--   -- 2. expect false: anon can no longer burn the invoice sequence
--   select has_function_privilege('anon','public.next_invoice_number()','EXECUTE') as anon_inv;
--
--   -- 3. expect 0 rows: every listed function now pins its search_path
--   select p.proname, p.proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proconfig is null
--     and p.proname in ('update_live_scorecard','calculate_player_stats',
--       'update_waitlist_updated_at','apply_scoring_event',
--       'refresh_player_all_time_stats','expire_old_subscription_requests',
--       'cleanup_verification_tokens','next_invoice_number');
--
--   -- 4. expect UNCHANGED count vs. before applying. Section 3 deliberately
--   --    makes no change here; if this number moves, something else did.
--   select count(*) from pg_policies where schemaname = 'public';
--
--   -- 5. smoke test the paths that DO depend on these functions:
--   --    authenticated reads through PostgREST, and invoice creation as
--   --    service_role. Both must still work.
-- ─────────────────────────────────────────────────────────────────────────────