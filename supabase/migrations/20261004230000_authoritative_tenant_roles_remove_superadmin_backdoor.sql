-- Decision 1: remove the hardcoded super-admin email backdoor.
-- Decision 2: make `current_tenant_roles` the authoritative source of tenant
--             membership, with the legacy `users.tenant_ids` array as fallback.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PREREQUISITE — break an RLS recursion cycle (must land with decision 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- `user_tenant_roles` was created with FORCE ROW LEVEL SECURITY. Its read policy
-- references `current_tenant_id()`. Decision 2 makes `current_tenant_id()` read
-- `user_tenant_roles`. With RLS forced, even the table owner is subject to
-- policies, and the SECURITY DEFINER `current_tenant_id()` (owner = postgres) is
-- therefore subject to that policy too:
--
--     current_tenant_id() -> user_tenant_roles -> policy -> current_tenant_id()
--
-- Postgres raises "infinite recursion detected in policy" for that, which would
-- break every authenticated read in the application.
--
-- Two changes break the cycle:
--   (a) NO FORCE — the owner (and SECURITY DEFINER functions it owns) can read
--       the table. anon/authenticated remain fully restricted by the policies.
--   (b) the read policy no longer calls `current_tenant_id()`.
--
-- Impact on the app: none. Every application path reads via service_role, which
-- bypasses RLS. These policies govern direct PostgREST access only, where
-- returning just the caller's own role rows is the correct, tighter behaviour.
ALTER TABLE public.user_tenant_roles NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tenant_roles_read ON public.user_tenant_roles;
CREATE POLICY user_tenant_roles_read ON public.user_tenant_roles
  FOR SELECT TO authenticated
  USING (user_id = current_user_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remove the hardcoded super-admin email
-- ─────────────────────────────────────────────────────────────────────────────
-- `is_super_admin()` contained:
--
--     IF user_email = 'kaash0542@gmail.com' THEN RETURN true; END IF;
--
-- Anyone able to register with that address became super-admin regardless of any
-- `users.role` value — a credential equivalent living in the database, and one
-- that survives password resets, 2FA, and key rotation.
--
-- The function already resolves super-admin from data in both branches
-- (`users.role` by auth uid, then by JWT email), so removing the hardcoded line
-- removes only the bypass. Added an explicit NULL guard for the email branch,
-- which previously ran a lookup with a NULL value.
--
-- LOCKOUT SAFETY: the only supported way to hold super-admin is now
-- `users.role = 'super_admin'`. Grant it with:
--
--   UPDATE public.users SET role = 'super_admin' WHERE email = '<your email>';
--
-- Run that BEFORE deploying this function if your account is not already a
-- super_admin row. The verification block at the end of this file includes a
-- pre-flight query for exactly this.
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'auth'
AS $function$
DECLARE
  user_email text;
  user_uuid uuid;
  user_role text;
BEGIN
  user_uuid := auth.uid();

  IF user_uuid IS NOT NULL THEN
    SELECT u.role INTO user_role FROM public.users u WHERE u.id = user_uuid;
    IF user_role = 'super_admin' THEN
      RETURN true;
    END IF;
  END IF;

  user_email := (auth.jwt() ->> 'email')::text;
  IF user_email IS NULL OR user_email = '' THEN
    RETURN false;
  END IF;

  SELECT u.role INTO user_role FROM public.users u WHERE u.email = user_email;
  RETURN COALESCE(user_role = 'super_admin', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tenant resolution: junction table authoritative, legacy array as fallback
-- ─────────────────────────────────────────────────────────────────────────────
-- ~90 RLS policies call `current_tenant_id()`, so this function is the backbone
-- of tenant isolation. Previously it read only the legacy `users.tenant_ids`
-- array, which can express exactly one membership list and is not per-tenant
-- role aware.
--
-- Design choice — "junction wins, legacy only as fallback" rather than a UNION
-- of both sources:
--
--   * UNION would WIDEN access. If the junction table ever held a stale tenant
--     membership, `tenant_id = ANY(current_tenant_id())` would match more rows
--     than before. Widening an isolation function is the wrong direction to err.
--   * Junction-authoritative means the new, role-aware data wins once present,
--     so a user removed from a tenant is correctly excluded even while the
--     legacy array still lists them.
--   * The fallback keeps every user provisioned before this change working.
--     Migration 20261004210000 backfilled the junction from `tenant_ids`, so
--     junction ⊇ legacy for pre-existing rows, and the backfill is idempotent.
--
-- `acceptInvite` writes both the junction row and the legacy array, so the two
-- stay in sync going forward.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'auth'
AS $function$
DECLARE
  legacy_tenants  uuid[];
  junction_tenants uuid[];
  user_pk         uuid;
  user_uuid       uuid;
  user_email      text;
BEGIN
  user_uuid := auth.uid();
  user_email := (auth.jwt() ->> 'email')::text;

  IF user_uuid IS NULL AND user_email IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  -- Resolve the internal users.id from either the auth uid or the JWT email,
  -- matching the lookup paths the previous implementation used.
  IF user_uuid IS NOT NULL THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.id = user_uuid;
  END IF;
  IF user_pk IS NULL AND user_email IS NOT NULL AND user_email <> '' THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.email = user_email;
  END IF;
  IF user_pk IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  -- Authoritative source: the junction table.
  SELECT COALESCE(array_agg(DISTINCT utr.tenant_id), ARRAY[]::uuid[])
    INTO junction_tenants
  FROM public.user_tenant_roles utr
  WHERE utr.user_id = user_pk;

  IF cardinality(junction_tenants) > 0 THEN
    RETURN junction_tenants;
  END IF;

  -- Fallback for users provisioned before the junction table existed.
  SELECT COALESCE(u.tenant_ids, ARRAY[]::uuid[])
    INTO legacy_tenants
  FROM public.users u
  WHERE u.id = user_pk;

  RETURN COALESCE(legacy_tenants, ARRAY[]::uuid[]);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT (run this BEFORE relying on super-admin):
--   select email, role from public.users order by email;
--   -- ensure your row reads role = 'super_admin', or apply the UPDATE above
--
-- 1. No FORCE, 2 policies, and none of them call current_tenant_id()
--   select relforcerowsecurity from pg_class
--    where oid = 'public.user_tenant_roles'::regclass;                  -- false
--   select policyname, qual from pg_policies
--    where schemaname='public' and tablename='user_tenant_roles';        -- 2 rows
--
-- 2. The hardcoded address must no longer appear anywhere:
--   select prosrc from pg_proc
--    where proname='is_super_admin' and prosrc ilike '%kaash0542%';     -- 0 rows
--
-- 3. No policy anywhere may reference a function that reads its own table:
--   -- expect 0 rows (the recursion guard)
--   select tablename, policyname from pg_policies
--   where schemaname='public'
--     and policyname = 'user_tenant_roles_read'
--     and qual ilike '%current_tenant_id%';
--
-- 4. Policy count unchanged at 90 (this migration only replaces policies on one
--    table; it adds none):
--   select count(*) from pg_policies where schemaname='public';         -- 90
--
-- 5. RUNTIME SMOKE TESTS — these require a signed-in user and are the only way
--    to prove decision 2 did not change effective permissions:
--      a. sign in, load /dashboard, confirm no permission-denied errors
--      b. a user who is league_owner in tenant A but scorer in tenant B must
--         see A's admin UI and be denied B's — this is the behaviour decision 2
--         was supposed to enable, and it is what the legacy path got wrong
--      c. create and accept a team_manager invite (exercises acceptInvite,
--         which was broken by the missing table)
-- ─────────────────────────────────────────────────────────────────────────────