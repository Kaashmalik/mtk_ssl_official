-- ============================================================================
-- Fix: refresh_player_all_time_stats() breaks `authenticated` writes.
--
-- THE BUG
-- `player_season_stats` carries a normal tenant-isolation policy
-- (`tenant_isolation_player_season_stats`, FOR ALL, TO authenticated), so an
-- authenticated user is *supposed* to be able to write their own tenant's rows.
-- They cannot. Every INSERT/UPDATE/DELETE on that table fires
--
--   trigger_refresh_player_all_time_stats  (AFTER INSERT OR DELETE OR UPDATE,
--                                           FOR EACH STATEMENT)
--
-- which calls refresh_player_all_time_stats(). That function is a plain
-- invoker-rights trigger, so it runs as `authenticated`, and
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires ownership of the
-- materialized view. The write therefore aborts:
--
--   ERROR: permission denied for materialized view player_all_time_stats
--
-- Reproduced directly (single-tenant user, own tenant, ROLLBACK):
--   DELETE FROM players WHERE name = 'Lahore Player 01';
--   -> ERROR: permission denied for materialized view player_all_time_stats
--
-- So the RLS policy advertises a write capability that is silently broken by a
-- trigger. The bug is currently latent rather than live: no application code
-- writes `player_season_stats` (it is read-only in `apps/web` and the mobile
-- app, via Drizzle on a privileged connection). The first person to implement
-- season-stat writes will hit it.
--
-- THE FIX
-- Make the function SECURITY DEFINER so the REFRESH runs with the privileges of
-- the function owner rather than the caller. `search_path` stays pinned.
--
-- Also revoke direct EXECUTE from anon/authenticated. PostgreSQL does not check
-- EXECUTE when a trigger *fires* (only when it is created), so this blocks
-- calling the function directly without disabling the trigger. Verified by
-- re-running the refresh afterwards.
--
-- ⚠️ KNOWN TRADEOFF — deliberately NOT resolved here
-- Refreshing a materialized view synchronously on the write path is a
-- well-known anti-pattern. It costs a full rebuild per writing *statement*, so
-- a loop of single-row inserts means one full rebuild per row. With the function
-- now SECURITY DEFINER, an authenticated user with write access to
-- `player_season_stats` can therefore amplify writes into repeated matview
-- rebuilds.
--
-- The correct fix is to move the refresh off the write path entirely — schedule
-- it (`pg_cron` is available on this project but not yet installed) or refresh
-- on read. That is NOT done here because it changes freshness semantics from
-- "immediately consistent" to "eventually consistent", which is a product
-- decision.
--
-- Worth weighing: `player_all_time_stats` is the only matview on the project and
-- is referenced by no application code at all — only by migration 017 and the
-- docs. If it is genuinely not needed, dropping the matview and its trigger
-- removes the problem rather than managing it.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_player_all_time_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Refresh concurrently to avoid blocking readers. See the migration header:
    -- this still costs a full rebuild per statement and is the reason the
    -- function is SECURITY DEFINER (so the REFRESH can succeed) rather than a
    -- fix for the underlying performance characteristic.
    REFRESH MATERIALIZED VIEW CONCURRENTLY player_all_time_stats;
    RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.refresh_player_all_time_stats() IS
  'Trigger-maintained refresh of player_all_time_stats. SECURITY DEFINER so the REFRESH succeeds for non-owner writers; synchronous refresh on the write path is a known anti-pattern (see migration 20261004250000).';

-- Direct invocation is unnecessary; triggers do not check EXECUTE at fire time.
REVOKE ALL ON FUNCTION public.refresh_player_all_time_stats() FROM PUBLIC, anon, authenticated;

COMMIT;