-- =============================================================================
-- 024: Harden PostgREST exposure for role / impersonation tables
--
-- Live grant check (Wave C): applied on SSL project `anxstufkbqnjkxgksfkn`
-- (mtkshakirsuperleague). Cursor MCP was previously pointed at an unrelated
-- dairy project — configure `--project-ref anxstufkbqnjkxgksfkn` for SSL.
--
-- Goal: even if anon/authenticated somehow hold default PUBLIC grants,
-- PostgREST cannot read role membership or impersonation sessions.
-- App access continues via DATABASE_URL (ssl / service_role) + app-layer
-- tenant isolation (Drizzle bypasses RLS).
-- =============================================================================

-- 1) user_tenant_roles --------------------------------------------------------
ALTER TABLE IF EXISTS public.user_tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_tenant_roles FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_tenant_roles FROM PUBLIC;
REVOKE ALL ON TABLE public.user_tenant_roles FROM anon;
REVOKE ALL ON TABLE public.user_tenant_roles FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_tenant_roles TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_tenant_roles TO ssl;
  END IF;
END $$;

DROP POLICY IF EXISTS "deny_all_user_tenant_roles" ON public.user_tenant_roles;
-- No permissive policies for anon/authenticated. service_role bypasses RLS.
-- Optional policy keeps super-admin JWT paths usable if ever wired through PostgREST.
DROP POLICY IF EXISTS "super_admin_all_user_tenant_roles" ON public.user_tenant_roles;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "super_admin_all_user_tenant_roles"
        ON public.user_tenant_roles
        FOR ALL
        USING (is_super_admin())
        WITH CHECK (is_super_admin())
    $pol$;
  ELSE
    -- Deny-by-default when helper is missing: empty policy set + FORCE RLS.
    NULL;
  END IF;
END $$;

-- 2) impersonation_sessions ---------------------------------------------------
ALTER TABLE IF EXISTS public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.impersonation_sessions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.impersonation_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.impersonation_sessions FROM anon;
REVOKE ALL ON TABLE public.impersonation_sessions FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.impersonation_sessions TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.impersonation_sessions TO ssl;
  END IF;
END $$;

DROP POLICY IF EXISTS "super_admin_all_impersonation_sessions" ON public.impersonation_sessions;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "super_admin_all_impersonation_sessions"
        ON public.impersonation_sessions
        FOR ALL
        USING (is_super_admin())
        WITH CHECK (is_super_admin())
    $pol$;
  END IF;
END $$;

COMMENT ON TABLE public.user_tenant_roles IS
  'Per-tenant roles. PostgREST anon/authenticated have no grants; RLS forced.';
COMMENT ON TABLE public.impersonation_sessions IS
  'Super-admin impersonation sessions. PostgREST anon/authenticated have no grants; RLS forced.';
