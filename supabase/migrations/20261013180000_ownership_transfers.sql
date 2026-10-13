-- Two-party league ownership transfer (IAM-07).
--
-- Ownership of a league (`tenants.owner_id`) may only move through an explicit,
-- mutually-consented handover: the recorded owner initiates a transfer to an
-- active member of the same league, and that member must accept it. Nothing
-- changes until the recipient consents, so an abandoned or mistaken request
-- cannot strand a league.
--
-- Acceptance is atomic and never leaves the league ownerless: the recipient is
-- promoted to `league_owner` in the same transaction that rewrites
-- `tenants.owner_id` and demotes the previous owner to `demoted_role`.
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). Local and
-- unapplied until the Batch 12 rollout gates are cleared.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ownership_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  demoted_role public.user_role NOT NULL DEFAULT 'team_manager',
  status text NOT NULL DEFAULT 'pending',
  version integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints (declared explicitly, not trusted to the enum type alone) ────

ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_status_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_status_check
  CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired'));

ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_distinct_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_distinct_check
  CHECK (from_user_id <> to_user_id);

ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_version_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_version_check
  CHECK (version >= 0);

-- The outgoing owner may never retain owner/platform authority by demotion.
ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_demoted_role_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_demoted_role_check
  CHECK (demoted_role NOT IN ('league_owner', 'super_admin'));

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- At most one open request per league; historical rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_pending_key
  ON public.ownership_transfers(tenant_id)
  WHERE status = 'pending';

-- Recipient inbox lookup ("do I have a pending transfer to accept?").
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_recipient
  ON public.ownership_transfers(to_user_id, status);

COMMENT ON TABLE public.ownership_transfers IS
  'Two-party league ownership handovers; the recipient must accept before tenants.owner_id moves.';

-- ─── Access control ───────────────────────────────────────────────────────────
-- Only the platform (service_role) needs this table; the application writes it
-- through server actions. PostgREST clients must not read or write it.
ALTER TABLE public.ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_transfers FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ownership_transfers FROM PUBLIC;
REVOKE ALL ON TABLE public.ownership_transfers FROM anon;
REVOKE ALL ON TABLE public.ownership_transfers FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ownership_transfers TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ownership_transfers TO ssl;
  END IF;
END $$;

COMMIT;
