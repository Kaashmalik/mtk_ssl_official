-- Invitation delivery events (IAM-04).
--
-- Extends the recorded dispatch outcome to include provider-reported delivery
-- events so a bounce or complaint is visible instead of being reported as a
-- successful send. Values are only ever written from a signature-verified
-- provider webhook (or the synchronous send attempt).
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). Local and
-- unapplied until the Batch 11 rollout gates are cleared.
BEGIN;

ALTER TABLE public.user_invites
  DROP CONSTRAINT IF EXISTS user_invites_email_state_check;
ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_email_state_check
  CHECK (email_state IS NULL OR email_state IN (
    'unconfigured', 'provider_accepted', 'delivered', 'bounced', 'complained', 'failed', 'unknown'
  ));

COMMENT ON COLUMN public.user_invites.email_state IS
  'Last recorded dispatch/delivery outcome. provider_accepted is not delivery; delivered/bounced/complained come from a verified provider webhook.';

COMMIT;
