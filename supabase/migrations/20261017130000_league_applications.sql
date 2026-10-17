-- Platform league applications (REG-01).
--
-- Today a league is created self-service (createTenant). For organizations
-- that need a reviewed onboarding, an account files one application here:
-- draft -> submitted -> platform review -> needs_information | approved |
-- rejected, with `withdrawn` available to the applicant while the application
-- is still active. The state machine lives in
-- packages/database/src/lib/league-application-policy.ts; this table stores
-- the record and the two duplicate-provisioning safeguards:
--
--   * league_applications_active_key  - at most one active application
--     (draft/submitted/needs_information) per applicant, so double submission
--     is impossible while a rejected or withdrawn application never blocks a
--     fresh one.
--   * league_applications_provisioned_key - a tenant may be the provisioning
--     receipt of at most one application; the admin review route writes
--     provisioned_tenant_id exactly once in the same transaction that flips
--     the state to `approved` under the applicant's row lock and a version
--     check, so a retried approval can never create a second league.
--
-- The desired plan is advisory input to the review. Approval provisions a
-- free-tier workspace; paid entitlements keep flowing through the existing
-- subscription/payment request flow.
--
-- Additive and idempotent: safe to replay. Local and unapplied until the
-- rollout gates are cleared (see supabase/MIGRATION_STATUS.md).
BEGIN;

CREATE TABLE IF NOT EXISTS public.league_applications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  applicant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  proposed_name text NOT NULL,
  proposed_slug text NOT NULL,
  desired_plan public.tenant_plan NOT NULL DEFAULT 'free',
  state text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 0,
  review_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  provisioned_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints (declared explicitly, not trusted to the enum type alone) ────

ALTER TABLE public.league_applications
  DROP CONSTRAINT IF EXISTS league_applications_state_check;
ALTER TABLE public.league_applications
  ADD CONSTRAINT league_applications_state_check
  CHECK (state IN ('draft', 'submitted', 'needs_information', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE public.league_applications
  DROP CONSTRAINT IF EXISTS league_applications_version_check;
ALTER TABLE public.league_applications
  ADD CONSTRAINT league_applications_version_check
  CHECK (version >= 0);

ALTER TABLE public.league_applications
  DROP CONSTRAINT IF EXISTS league_applications_name_check;
ALTER TABLE public.league_applications
  ADD CONSTRAINT league_applications_name_check
  CHECK (char_length(proposed_name) BETWEEN 2 AND 120);

-- Same shape the applicant form and writers enforce before insert.
ALTER TABLE public.league_applications
  DROP CONSTRAINT IF EXISTS league_applications_slug_check;
ALTER TABLE public.league_applications
  ADD CONSTRAINT league_applications_slug_check
  CHECK (proposed_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- At most one active application per applicant; terminal rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS league_applications_active_key
  ON public.league_applications(applicant_id)
  WHERE state IN ('draft', 'submitted', 'needs_information');

-- A tenant may be the provisioning receipt of at most one application.
CREATE UNIQUE INDEX IF NOT EXISTS league_applications_provisioned_key
  ON public.league_applications(provisioned_tenant_id)
  WHERE provisioned_tenant_id IS NOT NULL;

-- Platform review queue lookup (oldest first within a state).
CREATE INDEX IF NOT EXISTS idx_league_applications_queue
  ON public.league_applications(state, created_at);

COMMENT ON TABLE public.league_applications IS
  'Reviewed league onboarding: one active application per applicant; approval provisions at most one tenant.';

-- ─── Access control ───────────────────────────────────────────────────────────
-- Only the platform (service_role) needs this table; the applicant writes it
-- through server actions. PostgREST clients must not read or write it.
ALTER TABLE public.league_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_applications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.league_applications FROM PUBLIC;
REVOKE ALL ON TABLE public.league_applications FROM anon;
REVOKE ALL ON TABLE public.league_applications FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.league_applications TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.league_applications TO ssl;
  END IF;
END $$;

COMMIT;
