-- ENH-06-04 LOCAL ONLY (same discipline as the B159-B164 local migrations).
-- Apply before setting NOTIFICATION_JOBS_READY=true in a deployment.
BEGIN;

-- The durable notification outbox. A producer writes the job in the same
-- transaction as the fact that owes the notice; a bounded worker leases due
-- rows with SKIP LOCKED, delivers, and settles the state honestly.
--
-- tenant_id is NULL for account-level mail (e.g. onboarding), which must not
-- require league membership. The unique key makes producer retries idempotent
-- per event/recipient/channel; the lease token fences settlement between
-- replicas.
CREATE TABLE IF NOT EXISTS public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 160),
  channel text NOT NULL CHECK (channel IN ('in_app','email','push')),
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 64),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) <= 500),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','leased','provider_accepted','cancelled','dead_lettered')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_event_recipient_channel_key
  ON public.notification_jobs (event_id, recipient_user_id, channel);

CREATE INDEX IF NOT EXISTS notification_jobs_due_idx
  ON public.notification_jobs (next_attempt_at, id)
  WHERE state IN ('pending','leased');

CREATE INDEX IF NOT EXISTS notification_jobs_recipient_idx
  ON public.notification_jobs (recipient_user_id, created_at);

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_jobs FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.notification_jobs TO ssl;
    CREATE POLICY notification_jobs_ssl ON public.notification_jobs TO ssl
      USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.notification_jobs TO service_role;
    CREATE POLICY notification_jobs_service ON public.notification_jobs TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.notification_jobs IS
  'ENH-06-04: durable notification outbox. Rows are claimed with a bounded SKIP LOCKED lease; provider acceptance is not device delivery. tenant_id is NULL only for account-level notices that do not require league membership.';

COMMIT;
