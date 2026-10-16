-- Batch 63: additive INTERNAL journal, not public/member-readable. Unapplied here.
-- Reconcile history and verify on a disposable database before any remote rollout.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS matches_id_tenant_key ON public.matches(id, tenant_id);
CREATE TABLE public.scoring_outbox (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  match_id uuid NOT NULL,
  topic text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_outbox_match_tenant_fk FOREIGN KEY (match_id, tenant_id)
    REFERENCES public.matches(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT scoring_outbox_attempts_check CHECK (attempts >= 0),
  CONSTRAINT scoring_outbox_topic_check CHECK (topic IN ('ssl.scoring.ball-events', 'ssl.match.events')),
  CONSTRAINT scoring_outbox_envelope_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload->>'tenantId' IS NOT NULL AND payload->>'tenantId' = tenant_id::text
    AND payload->>'matchId' IS NOT NULL AND payload->>'matchId' = match_id::text
    AND payload->>'eventId' IS NOT NULL AND payload->>'eventId' = event_id
  )
);
CREATE UNIQUE INDEX scoring_outbox_event_key ON public.scoring_outbox(topic, event_id);
CREATE INDEX scoring_outbox_pending_idx ON public.scoring_outbox(id) WHERE delivered_at IS NULL;
CREATE INDEX scoring_outbox_match_pending_idx ON public.scoring_outbox(tenant_id, match_id, id) WHERE delivered_at IS NULL;

ALTER TABLE public.scoring_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.scoring_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.scoring_outbox_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.scoring_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scoring_outbox_id_seq TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.scoring_outbox TO ssl;
    GRANT USAGE, SELECT ON SEQUENCE public.scoring_outbox_id_seq TO ssl;
    CREATE POLICY scoring_outbox_internal_ssl ON public.scoring_outbox TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMENT ON TABLE public.scoring_outbox IS
  'Internal transactional scoring delivery journal. At-least-once; preserve pending rows. No public/member access.';
COMMIT;
