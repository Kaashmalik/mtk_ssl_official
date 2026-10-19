-- Batch 176 - repair the pre-ISO-06 league-membership shape.
--
-- 20260623 backfilled public.user_tenant_roles from users.tenant_ids using
-- users.role, so a platform super_admin ended up with a LEAGUE membership of
-- 'super_admin'. 20261012100136 (ISO-06) states the invariant explicitly -
-- "A global platform role is never copied into league authority" - and maps
-- platform roles to 'fan' (or 'league_owner' for the tenant's actual owner),
-- but its backfill used ON CONFLICT DO NOTHING, so the legacy rows were never
-- repaired.
--
-- The application enforces the same invariant on every read:
--   - lib/league-reads.requireActiveLeagueContext rejects membership.role
--     === 'super_admin'
--   - lib/dashboard-context.getDashboardContext rejects platform roles
--     (isPlatformRole)
--   - app/actions/tenants membership resolution excludes 'super_admin'
-- A seeded super_admin owner therefore saw every league page fail with
-- "Forbidden: league access unavailable" (the "Tournament Management Error"
-- boundary in production). Platform authority lives in users.role
-- (super_admin|fan, enforced by users_role_platform_only) and RLS
-- is_super_admin(); league authority lives ONLY in user_tenant_roles.
--
-- This migration repairs the legacy rows using ISO-06's own mapping and then
-- enforces the invariant with a CHECK constraint, so the shape cannot return.
-- No application writer can produce it: the tenant-creation, invite and
-- ownership-transfer paths all write league roles.
BEGIN;

-- Owner of the league -> league_owner; anyone else -> fan.
UPDATE public.user_tenant_roles m
SET role = CASE
      WHEN t.owner_id = m.user_id THEN 'league_owner'::public.user_role
      ELSE 'fan'::public.user_role
    END,
    updated_at = now()
FROM public.tenants t
WHERE t.id = m.tenant_id
  AND m.role = 'super_admin'
  AND m.role <> CASE
      WHEN t.owner_id = m.user_id THEN 'league_owner'::public.user_role
      ELSE 'fan'::public.user_role
    END;

-- A league membership never carries a platform role.
ALTER TABLE public.user_tenant_roles
  ADD CONSTRAINT user_tenant_roles_no_platform_role
  CHECK (role <> 'super_admin');

COMMIT;
