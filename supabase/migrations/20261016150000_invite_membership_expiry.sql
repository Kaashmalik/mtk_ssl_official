-- Invitation-proposed membership expiry bounds (IAM-03/04 interplay with SCORE-09).
--
-- An issuing owner may now propose, at invitation time, the expiry bound the
-- redeemed league membership should carry. The bound is stored on the invite
-- row itself (`membership_expires_at`), disclosed to the recipient by the
-- bearer-link preview before acceptance, and applied at redemption with
-- `delegated_by_user_id` provenance pointing at the issuing owner:
--   - a new membership is provisioned with the proposed bound;
--   - an existing active membership of the same role has its bound replaced
--     (the issuer is a verified active league owner; the write is audited);
--   - an invite with NULL proposes no change: redemption leaves any existing
--     bound exactly as it is.
--
-- This is distinct from `user_invites.expires_at`, which bounds the invitation
-- link itself. The CHECK keeps a proposed bound chronologically sane (it must
-- postdate the invite's creation, since acceptance always happens later).
--
-- Additive and idempotent: safe to replay. Existing rows keep NULL and behave
-- exactly as before. RLS/grants on user_invites are unchanged; the new column
-- is covered by the table's existing policies. Applied through the Supabase
-- MCP (see supabase/MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.user_invites
  ADD COLUMN IF NOT EXISTS membership_expires_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.user_invites
    ADD CONSTRAINT user_invites_membership_expiry_check
    CHECK (membership_expires_at IS NULL OR membership_expires_at > created_at);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.user_invites.membership_expires_at IS
  'Optional league-membership expiry bound proposed by the issuing owner; applied to the redeemed membership with delegated_by_user_id provenance at acceptance. NULL proposes no bound and redemption leaves any existing bound untouched.';

COMMIT;
