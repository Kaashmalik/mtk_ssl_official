-- Corrective follow-up to 20261004200000_harden_public_surface_privileges.sql.
--
-- That migration revoked EXECUTE on `next_invoice_number` from PUBLIC and the
-- revoke appeared to succeed. Verification then showed
-- `has_function_privilege('anon', ..., 'EXECUTE')` was STILL true.
--
-- Cause: EXECUTE was not being inherited from PUBLIC. This database has
-- explicit per-role grants, visible in pg_proc.proacl as:
--
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- `REVOKE ... FROM PUBLIC` removes only the PUBLIC grant. Any role named
-- directly in the ACL keeps its own grant, so the anon/authenticated entries
-- survived untouched.
--
-- Fix: revoke from the named roles explicitly. service_role is retained because
-- the Nest invoice flow calls this function server-side.
--
-- Verified after applying:
--   select has_function_privilege('anon','public.next_invoice_number()','EXECUTE');
--   select has_function_privilege('service_role','public.next_invoice_number()','EXECUTE');
--   -- expect false, true
--
-- Lesson applied to the audit: for Supabase-provisioned projects, never assume
-- a privilege comes from PUBLIC. Inspect pg_proc.proacl / pg_class.relacl
-- before and after, because a REVOKE from PUBLIC can be a silent no-op.

REVOKE ALL ON FUNCTION public.next_invoice_number() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number(integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(integer) TO service_role;

-- Belt and braces: the same explicit-grant trap could apply to the matview.
-- Confirm rather than assume.
REVOKE ALL ON public.player_all_time_stats FROM anon, authenticated;
GRANT  ALL ON public.player_all_time_stats TO service_role;