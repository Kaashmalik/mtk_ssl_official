-- Create the missing `user_tenant_roles` junction table.
--
-- WHY THIS IS REQUIRED
-- --------------------
-- `packages/database/src/schema/user-tenant-roles.ts` defines this table and
-- exports it, and two production code paths depend on it:
--
--   * apps/web/src/lib/rbac-server.ts:49-58  — the junction-first tenant role
--     lookup used by `hasPermissionServer` / `requirePermissionServer`.
--   * apps/web/src/app/actions/users-invites.ts:221-237 — reads and writes it in
--     `acceptInvite`.
--
-- Inspection of the live project showed `to_regclass('public.user_tenant_roles')`
-- = NULL: the table was defined in the Drizzle schema but never created in the
-- database.
--
-- Observed impact:
--   * `acceptInvite` has NO error handling around this query, so redeeming a team
--     manager / coach / scorer invite fails outright with
--     "relation public.user_tenant_roles does not exist". Invite flow is broken.
--   * `getUserRoleForTenant` wraps the query in try/catch and falls back to the
--     legacy `users.role` + `users.tenant_ids` columns. This fails *silently*,
--     which is worse in one respect: a user who is `league_owner` in tenant A and
--     `scorer` in tenant B receives their legacy single role everywhere, so
--     per-tenant permissions are wrong without any error surfacing.
--
-- Column types are matched exactly to the Drizzle schema and to the live
-- `users` table (uuid PK). `uuid_generate_v7()` and the `user_role` enum were
-- both verified to already exist in this database.

CREATE TABLE IF NOT EXISTS public.user_tenant_roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'fan',
  -- True if this is the user's primary/default tenant.
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- One role per (user, tenant). The Drizzle schema omits this, but the lookup
  -- in rbac-server.ts does `.limit(1)` on (user_id, tenant_id) and then reads a
  -- single `role`, so duplicates would make the effective permission
  -- non-deterministic. Kept here so future `db:generate` does not drift; the
  -- matching `unique()` has been added to the Drizzle schema as well.
  CONSTRAINT user_tenant_roles_user_tenant_key UNIQUE (user_id, tenant_id)
);

COMMENT ON TABLE public.user_tenant_roles IS
  'User-tenant role junction: one row per (user, tenant). Replaces the single users.role + users.tenant_ids design.';

-- Tenant-wide lookups (admin UIs listing everyone in a league) filter on
-- tenant_id alone, which the UNIQUE index above does not cover.
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_tenant_id
  ON public.user_tenant_roles (tenant_id);

-- Reuse the project's shared updated_at trigger function (18 other tables use it).
DROP TRIGGER IF EXISTS user_tenant_roles_updated_at ON public.user_tenant_roles;
CREATE TRIGGER user_tenant_roles_updated_at
  BEFORE UPDATE ON public.user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
--
-- Idiom copied from the existing policies in this database:
--   tenant isolation -> tenant_id = ANY (current_tenant_id())
--   super admin      -> is_super_admin()
--   own row          -> user_id = current_user_id()   (current_user_id() = auth.uid())
--
-- Scoped `TO authenticated` so anon receives nothing at all.
--
-- IMPORTANT — known limitation, deliberately not "fixed" here:
-- `current_tenant_id()` resolves tenants from the LEGACY `users.tenant_ids`
-- array only. It does not consult this table. So tenant isolation for THIS table
-- is enforced against the legacy array until `current_tenant_id()` is widened to
-- union both sources. Widening it is a separate, riskier change: ~88 existing
-- policies depend on its current behaviour, and `users.tenant_ids` is still the
-- source of truth for existing rows. Do not change it in the same migration.
--
-- Application writes (acceptInvite) run as service_role, which bypasses RLS, so
-- these policies govern direct PostgREST access only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenant_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tenant_roles_read ON public.user_tenant_roles;
CREATE POLICY user_tenant_roles_read ON public.user_tenant_roles
  FOR SELECT TO authenticated
  USING (
    user_id = current_user_id()
    OR tenant_id = ANY (current_tenant_id())
  );

DROP POLICY IF EXISTS user_tenant_roles_super_admin_all ON public.user_tenant_roles;
CREATE POLICY user_tenant_roles_super_admin_all ON public.user_tenant_roles
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill so per-tenant RBAC has a source of truth immediately.
--
-- The legacy design allowed exactly one role per user across all of their
-- tenants, so the projection is lossless with respect to existing behaviour:
-- every legacy membership becomes one junction row carrying the same role, and
-- the first tenant is marked primary. This is also what makes the junction-first
-- lookup return the same answer the legacy fallback did, so enabling this
-- migration does not change anyone's effective permissions.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT
  u.id,
  tid,
  u.role,
  (
    tid = (
      SELECT a.x
      FROM unnest(COALESCE(u.tenant_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS a(x, n)
      ORDER BY a.n
      LIMIT 1
    )
  )
FROM public.users u
CROSS JOIN LATERAL unnest(COALESCE(u.tenant_ids, ARRAY[]::uuid[])) AS tid
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run after applying):
--
--   -- 1. table exists, RLS on and forced, 2 policies
--   select relname, relrowsecurity, relforcerowsecurity
--   from pg_class where oid = 'public.user_tenant_roles'::regclass;
--   select count(*) from pg_policies where schemaname='public'
--    and tablename='user_tenant_roles';                                  -- expect 2
--
--   -- 2. backfill landed: one row per legacy membership
--   select count(*) from public.user_tenant_roles;
--   select count(*) from public.users
--    where cardinality(COALESCE(tenant_ids, ARRAY[]::uuid[])) > 0;      -- expect equal
--
--   -- 3. exactly one primary per user that has any row
--   select user_id, count(*) filter (where is_primary) as primaries
--   from public.user_tenant_roles group by user_id having primaries > 1;  -- expect 0 rows
--
--   -- 4. existing RLS policies unchanged (88 before, 88 after — this migration
--   --    adds policies only on the new table)
--   select count(*) from pg_policies where schemaname='public';
--
--   -- 5. invite flow: accept a team_manager invite, then confirm
--   --    getUserRoleForTenant resolves without falling back to the legacy path.
-- ─────────────────────────────────────────────────────────────────────────────