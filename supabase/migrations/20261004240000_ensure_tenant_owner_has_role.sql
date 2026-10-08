-- ============================================================================
-- Ensure every tenant owner actually holds a role in their own tenant.
--
-- THE BUG THIS FIXES
-- `tenants.owner_id` and `user_tenant_roles` are two independent sources of
-- truth, and nothing tied them together. `current_tenant_id()` reads the
-- junction table, so a tenant whose `owner_id` has no corresponding
-- `user_tenant_roles` row produces a tenant owner who is locked out of their
-- own league: every RLS policy evaluates `current_tenant_id()` to NULL and denies.
--
-- Confirmed live in this project before the fix:
--
--   tenant `ssl` (Shakir Super League, enterprise)
--     owner_id -> kashif@maliktech.pk
--     users.role = 'fan', users.tenant_ids = '{}', user_tenant_roles = 0 rows
--     => owner cannot read or write anything in the league they own
--
-- The previous pass reported the database as empty and so could not observe this.
-- It was not empty.
--
-- THE FIX
-- 1. Backfill any tenant whose owner has no membership row (idempotent).
-- 2. Install a trigger so the invariant holds for future tenants and for any
--    future `owner_id` change, instead of relying on every code path to remember
--    to insert the role row.
--
-- DELIBERATE NON-DESTRUCTIVE BEHAVIOUR
-- This only ever ADDS a missing row (`ON CONFLICT DO NOTHING`). It never
-- overwrites or removes an existing role, so it cannot silently promote or demote
-- anyone. In particular a user who is deliberately a `scorer` in a tenant they
-- do not own keeps that role.
--
-- Note this can leave an owner holding, say, `scorer` in their own tenant if such
-- a row already exists. Narrowing an existing owner role is a data decision and
-- is deliberately out of scope here.
--
-- Sentinel owners (`system-default` uses the all-zero UUID) are skipped: they do
-- not exist in `users`, and `user_tenant_roles.user_id` is a real FK, so the
-- insert would fail.
-- ============================================================================

BEGIN;

-- ─── 1. Backfill the gaps ───────────────────────────────────────────────────

INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT
  t.owner_id,
  t.id,
  'league_owner',
  -- Mark primary only if this user has no other primary membership.
  NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles x
    WHERE x.user_id = t.owner_id AND x.is_primary
  )
FROM public.tenants t
-- Inner join: drops placeholder/sentinel owners that are not real users.
JOIN public.users u ON u.id = t.owner_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_tenant_roles utr
  WHERE utr.user_id = t.owner_id AND utr.tenant_id = t.id
)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ─── 2. Maintain the invariant going forward ────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_tenant_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE only act when owner_id genuinely changed, so unrelated tenant
  -- edits do not churn this table.
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NEW;
  END IF;

  -- Placeholder owners (e.g. the all-zero sentinel) have no `users` row and the
  -- FK below would reject the insert. Skip rather than fail the tenant write.
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.owner_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
  VALUES (
    NEW.owner_id,
    NEW.id,
    'league_owner',
    NOT EXISTS (
      SELECT 1 FROM public.user_tenant_roles x
      WHERE x.user_id = NEW.owner_id AND x.is_primary
    )
  )
  ON CONFLICT (user_id, tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_tenant_owner_role() IS
  'Maintains the invariant that a tenant owner holds a role in their own tenant. Adds only; never modifies an existing role.';

DROP TRIGGER IF EXISTS trg_ensure_tenant_owner_role ON public.tenants;

CREATE TRIGGER trg_ensure_tenant_owner_role
AFTER INSERT OR UPDATE OF owner_id ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.ensure_tenant_owner_role();

-- The function is SECURITY DEFINER, so lock down execution: only the trigger
-- needs to run it. Leaving this callable by `authenticated` would be an
-- unauthenticated-ish write primitive.
REVOKE ALL ON FUNCTION public.ensure_tenant_owner_role() FROM PUBLIC, anon, authenticated;

COMMIT;