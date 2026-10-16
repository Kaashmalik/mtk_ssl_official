-- Match official approval (COMP-06 / IAM-06): scorer assignment consent.
--
-- An owner's scorer assignment is currently unilateral: the assigned member
-- can start scoring without ever acknowledging the assignment. This migration
-- adds the acceptance state to the match itself:
--   `scorer_approval_required`
--       true once either scorer slot is occupied by a current assignment write
--       (legacy rows default to false, so existing fixtures keep their
--       readiness semantics and no backfill is needed).
--   `scorer_approved_at`
--       the instant the assigned primary or backup scorer approved the
--       assignment. Cleared by every subsequent assignment change: consent
--       binds to the exact assignment, and only the assigned member can set
--       it (enforced application-side with a row lock and a conditional
--       update, audited as SCORER_ASSIGNMENT_APPROVE).
--
-- Additive and idempotent: safe to replay. RLS/grants on matches unchanged;
-- the new columns are covered by the table's existing policies. Applied
-- through the Supabase MCP (see supabase/MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS scorer_approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scorer_approved_at timestamptz;

COMMENT ON COLUMN public.matches.scorer_approval_required IS
  'True once a current assignment write has occupied a scorer slot; legacy matches stay false and keep legacy readiness. Consent (scorer_approved_at) is expected from the assigned member when this is true.';

COMMENT ON COLUMN public.matches.scorer_approved_at IS
  'When the assigned primary or backup scorer approved the assignment. Cleared by any assignment change; only the assigned member may set it.';

COMMIT;
