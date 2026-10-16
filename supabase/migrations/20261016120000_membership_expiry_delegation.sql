-- Bounded league memberships (SCORE-09).
--
-- A membership may now carry an explicit expiry instant: when `expires_at` is
-- set, the membership stops granting access once it passes, without deleting
-- history or the row. `delegated_by_user_id` records which owner granted or
-- last extended the bound (provenance only — it never grants rights by
-- itself). Unbounded memberships (expires_at NULL) behave exactly as before.
--
-- Enforcement is fail-closed and shared: packages/database membership-
-- effectiveness policy re-checked at the canonical scoring write boundary and
-- in web member administration. The database CHECK keeps a bound chronologically
-- sane (an expiry must postdate the membership's creation).
--
-- Additive and idempotent: safe to replay. Existing rows keep NULL expiry and
-- keep working unchanged. RLS on user_tenant_roles is unchanged; the new
-- columns are covered by the table's existing grants and policies. Local and
-- unapplied until the Batch 65 rollout gates are cleared (see
-- supabase/MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.user_tenant_roles
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delegated_by_user_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.user_tenant_roles
    ADD CONSTRAINT user_tenant_roles_expiry_check
    CHECK (expires_at IS NULL OR expires_at > created_at);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_expires_at
  ON public.user_tenant_roles(tenant_id) WHERE expires_at IS NOT NULL;

COMMIT;
