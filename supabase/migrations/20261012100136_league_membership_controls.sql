-- Expand existing membership rows; do not change global accounts or assignments.
-- Apply only after reconciling the existing migration history (MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.user_tenant_roles
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT user_tenant_roles_status_check CHECK (status IN ('active', 'suspended')),
  ADD CONSTRAINT user_tenant_roles_version_check CHECK (version >= 0);

-- Preserve explicit roles. Backfill only absent rows with valid league references.
-- A global platform role is never copied into league authority. Legacy owner
-- privilege is recognized only for the actual owner of that league.
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT u.id, t.id,
  CASE
    WHEN t.owner_id = u.id THEN 'league_owner'::public.user_role
    WHEN u.role IN ('super_admin', 'league_owner') THEN 'fan'::public.user_role
    ELSE u.role
  END,
  false
FROM public.users u
CROSS JOIN LATERAL unnest(u.tenant_ids) AS legacy(tenant_id)
JOIN public.tenants t ON t.id = legacy.tenant_id
ON CONFLICT (user_id, tenant_id) DO NOTHING;

INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT u.id, t.id, 'league_owner'::public.user_role, false
FROM public.tenants t JOIN public.users u ON u.id = t.owner_id
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Shared versioning catches updates from any trusted writer, not just this UI.
CREATE FUNCTION public.bump_league_membership_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_tenant_roles_version
  BEFORE UPDATE ON public.user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION public.bump_league_membership_version();

-- Membership changes must use the authenticated, audited server command path.
-- Existing owner policies based on legacy role/arrays cannot bypass these checks.
REVOKE INSERT, UPDATE, DELETE ON public.user_tenant_roles FROM anon, authenticated;

-- Direct account writes must not change role/is_active/tenant_ids through the
-- legacy self-update policy. Profile changes continue through trusted app APIs.
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;

-- Keep the existing UUID/email identity bridge for this release (Clerk subject
-- mapping requires the separate identity migration). Narrow tenant authority to
-- active accounts, active explicit memberships and active leagues; no array
-- fallback after removal/suspension. Function ownership must remain a trusted
-- RLS-bypassing migration owner, as in 20261004230000, to avoid RLS recursion.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_pk uuid;
  user_uuid uuid;
  user_email text;
  result uuid[];
BEGIN
  user_uuid := auth.uid();
  user_email := auth.jwt() ->> 'email';
  IF user_uuid IS NOT NULL THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.id = user_uuid;
  END IF;
  IF user_pk IS NULL AND user_email IS NOT NULL AND user_email <> '' THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.email = user_email;
  END IF;
  IF user_pk IS NULL THEN RETURN ARRAY[]::uuid[]; END IF;
  SELECT COALESCE(array_agg(DISTINCT m.tenant_id), ARRAY[]::uuid[]) INTO result
  FROM public.user_tenant_roles m
  JOIN public.users u ON u.id = m.user_id
  JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = user_pk AND m.status = 'active'
    AND m.role <> 'super_admin' AND u.is_active = true AND t.is_active = true;
  RETURN result;
END;
$$;

-- Platform access is still distinct, but inactive global accounts must not
-- bypass membership through the database's existing platform-admin policies.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_uuid uuid;
  user_email text;
  result boolean;
BEGIN
  user_uuid := auth.uid();
  IF user_uuid IS NOT NULL THEN
    SELECT u.role = 'super_admin' AND u.is_active = true INTO result
      FROM public.users u WHERE u.id = user_uuid;
    IF FOUND THEN RETURN result; END IF;
  END IF;
  user_email := auth.jwt() ->> 'email';
  IF user_email IS NULL OR user_email = '' THEN RETURN false; END IF;
  SELECT u.role = 'super_admin' AND u.is_active = true INTO result
    FROM public.users u WHERE u.email = user_email;
  RETURN COALESCE(result, false);
END;
$$;

COMMENT ON COLUMN public.user_tenant_roles.status IS
  'League-only active/suspended status. Global account state remains users.is_active.';
COMMENT ON COLUMN public.user_tenant_roles.version IS
  'Database-incremented optimistic concurrency version for membership changes.';

COMMIT;
