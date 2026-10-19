-- Batch 159, LOCAL ONLY. Apply in a reviewed deployment before enabling INVITATION_EMAIL_QUEUE_READY.
BEGIN;
ALTER TABLE public.user_invites ADD CONSTRAINT user_invites_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.user_invites DROP CONSTRAINT user_invites_email_state_check;
ALTER TABLE public.user_invites ADD CONSTRAINT user_invites_email_state_check CHECK (
  email_state IS NULL OR email_state IN ('unconfigured','provider_accepted','delivered','bounced','complained','failed','unknown','queued','retry_scheduled','dead_lettered')
);
CREATE TABLE public.invitation_email_jobs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invite_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (length(token_hash) = 64),
  encrypted_message text,
  key_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','provider_accepted','cancelled','dead_lettered')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text CHECK (last_error IN ('provider_rejected','network_unknown','decrypt_failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT invitation_email_jobs_live_payload CHECK (state NOT IN ('pending','leased') OR encrypted_message IS NOT NULL),
  CONSTRAINT invitation_email_jobs_invite_token_key UNIQUE (invite_id, token_hash)
  ,CONSTRAINT invitation_email_jobs_invite_tenant_fk FOREIGN KEY (invite_id, tenant_id)
    REFERENCES public.user_invites(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX invitation_email_jobs_due_idx ON public.invitation_email_jobs(next_attempt_at, id)
  WHERE state IN ('pending','leased');
CREATE INDEX invitation_email_jobs_tenant_idx ON public.invitation_email_jobs(tenant_id, invite_id);
ALTER TABLE public.invitation_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_email_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitation_email_jobs FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.invitation_email_jobs TO ssl;
    CREATE POLICY invitation_email_jobs_ssl ON public.invitation_email_jobs TO ssl USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.invitation_email_jobs TO service_role;
    CREATE POLICY invitation_email_jobs_service ON public.invitation_email_jobs TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMENT ON TABLE public.invitation_email_jobs IS 'Encrypted, leased invitation dispatch outbox. Provider acceptance is NOT delivery. Plaintext invitation links never stored. Terminal payloads scrubbed.';
COMMIT;
