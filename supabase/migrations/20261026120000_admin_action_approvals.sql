-- Two-person approval for destructive platform-admin actions.
--
-- A destructive action (today: permanently deleting a league) is never executed
-- by the super admin who asks for it. The requester records the action, the
-- target and a reason; a DIFFERENT active super admin must approve before the
-- action runs. Requests lapse after `expires_at` and must be re-issued.
--
-- `target_tenant_id` deliberately has NO foreign key: the approval record is the
-- evidence trail for the deletion and must survive the deletion of its target.
-- `target_label` snapshots the league name for the same reason.
--
-- Status lifecycle: pending -> executed | rejected | cancelled | expired
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md).
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_action_approvals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  action text NOT NULL,
  target_tenant_id uuid NOT NULL,
  target_label text NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────

ALTER TABLE public.admin_action_approvals
  DROP CONSTRAINT IF EXISTS admin_action_approvals_action_check;
ALTER TABLE public.admin_action_approvals
  ADD CONSTRAINT admin_action_approvals_action_check
  CHECK (action IN ('tenant.delete'));

ALTER TABLE public.admin_action_approvals
  DROP CONSTRAINT IF EXISTS admin_action_approvals_status_check;
ALTER TABLE public.admin_action_approvals
  ADD CONSTRAINT admin_action_approvals_status_check
  CHECK (status IN ('pending', 'executed', 'rejected', 'cancelled', 'expired'));

-- The requester can never approve their own request (cancelling is allowed and
-- is recorded with decided_by = requested_by only for status 'cancelled').
ALTER TABLE public.admin_action_approvals
  DROP CONSTRAINT IF EXISTS admin_action_approvals_second_person_check;
ALTER TABLE public.admin_action_approvals
  ADD CONSTRAINT admin_action_approvals_second_person_check
  CHECK (status <> 'executed' OR (decided_by IS NOT NULL AND decided_by <> requested_by));

ALTER TABLE public.admin_action_approvals
  DROP CONSTRAINT IF EXISTS admin_action_approvals_reason_check;
ALTER TABLE public.admin_action_approvals
  ADD CONSTRAINT admin_action_approvals_reason_check
  CHECK (char_length(btrim(reason)) >= 10);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- At most one open request per action and target.
CREATE UNIQUE INDEX IF NOT EXISTS admin_action_approvals_pending_key
  ON public.admin_action_approvals(action, target_tenant_id)
  WHERE status = 'pending';

-- Approval queue lookup.
CREATE INDEX IF NOT EXISTS idx_admin_action_approvals_status
  ON public.admin_action_approvals(status, created_at DESC);

COMMENT ON TABLE public.admin_action_approvals IS
  'Two-person approval queue for destructive platform-admin actions; survives deletion of its target.';

-- ─── Access control ───────────────────────────────────────────────────────────
-- Only the platform (service_role) needs this table. PostgREST clients must not
-- read or write it.
ALTER TABLE public.admin_action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_action_approvals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_action_approvals FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_action_approvals FROM anon;
REVOKE ALL ON TABLE public.admin_action_approvals FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_action_approvals TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_action_approvals TO ssl;
  END IF;
END $$;

COMMIT;
