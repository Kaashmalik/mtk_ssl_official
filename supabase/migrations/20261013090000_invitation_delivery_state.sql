-- Invitation dispatch tracking (IAM-04).
--
-- Records the LAST dispatch outcome and attempt count for an invitation so the
-- UI can show a truthful provider state and enforce a resend cooldown. Provider
-- acceptance is deliberately NOT stored as delivery: the column only ever holds
-- unconfigured | provider_accepted | failed | unknown.
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). This file is
-- local and unapplied until the Batch 8 rollout gates are cleared.
BEGIN;

ALTER TABLE public.user_invites
  ADD COLUMN IF NOT EXISTS email_state text,
  ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_attempt_count integer NOT NULL DEFAULT 0;

-- Constrain the recorded outcome so an unknown value cannot be persisted.
ALTER TABLE public.user_invites
  DROP CONSTRAINT IF EXISTS user_invites_email_state_check;
ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_email_state_check
  CHECK (email_state IS NULL OR email_state IN ('unconfigured', 'provider_accepted', 'failed', 'unknown'));

COMMENT ON COLUMN public.user_invites.email_state IS
  'Last recorded dispatch outcome. provider_accepted is not delivery confirmation.';
COMMENT ON COLUMN public.user_invites.email_attempted_at IS
  'Instant of the last dispatch attempt; used for the resend cooldown.';
COMMENT ON COLUMN public.user_invites.email_attempt_count IS
  'Number of dispatch attempts (initial create plus resends).';

COMMIT;
