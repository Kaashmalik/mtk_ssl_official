-- Umpire consent (COMP-06, Batch 73): member-umpire assignment acknowledgment.
--
-- Batch 72 added member-bound umpire slots (umpire1_id/umpire2_id) assigned
-- unilaterally by an owner. This migration adds the acceptance state, mirroring
-- the scorer-consent pair introduced in Batch 71:
--   `umpire_approval_required`
--       true once a current assignment write has occupied a member umpire slot
--       (legacy rows and free-text-only matches stay false, so existing
--       readiness semantics survive without backfill).
--   `umpire_approved_at`
--       the instant the assigned first or second umpire approved. Cleared by
--       any subsequent assignment change: consent binds to the exact
--       assignment, and only the assigned member can set it (enforced
--       application-side with the canonical row lock and a conditional
--       update, audited as UMPIRE_ASSIGNMENT_APPROVE).
--
-- Additive and idempotent: safe to replay. RLS/grants on matches unchanged;
-- the new columns are covered by the table's existing policies. Applied
-- through the Supabase MCP (see supabase/MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS umpire_approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS umpire_approved_at timestamptz;

COMMENT ON COLUMN public.matches.umpire_approval_required IS
  'True once a current assignment write has occupied a member umpire slot; free-text-only and legacy matches stay false and keep legacy readiness. Consent (umpire_approved_at) is expected from the assigned member when this is true.';

COMMENT ON COLUMN public.matches.umpire_approved_at IS
  'When the assigned first or second umpire approved the assignment. Cleared by any assignment change; only the assigned member may set it.';

COMMIT;
