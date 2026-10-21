-- ENH-08-01/02 LOCAL ONLY. Apply before any broadcast route/worker is enabled.
-- Additive: legacy matches.live_stream_url/stream_source/stream_status remain
-- readable and are not rewritten by this migration. Provider credentials are
-- opaque secret references, never plaintext tokens.
BEGIN;

CREATE TABLE IF NOT EXISTS public.broadcast_connections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('youtube','facebook')),
  external_account_id text NOT NULL CHECK (length(external_account_id) BETWEEN 1 AND 300),
  display_name text NOT NULL,
  credential_ref text NOT NULL CHECK (length(credential_ref) BETWEEN 1 AND 500),
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  expires_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS broadcast_connections_id_tenant_key
  ON public.broadcast_connections (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_connections_tenant_provider_account_key
  ON public.broadcast_connections (tenant_id, provider, external_account_id);
CREATE INDEX IF NOT EXISTS broadcast_connections_tenant_status_idx
  ON public.broadcast_connections (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.broadcast_destinations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('youtube','facebook')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 300),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('channel','playlist','page')),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_destinations_connection_tenant_fk
    FOREIGN KEY (connection_id, tenant_id)
    REFERENCES public.broadcast_connections (id, tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS broadcast_destinations_id_tenant_key
  ON public.broadcast_destinations (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_destinations_tenant_provider_external_key
  ON public.broadcast_destinations (tenant_id, provider, external_id);
CREATE INDEX IF NOT EXISTS broadcast_destinations_tenant_connection_idx
  ON public.broadcast_destinations (tenant_id, connection_id);

CREATE TABLE IF NOT EXISTS public.broadcast_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('youtube','facebook')),
  session_number integer NOT NULL DEFAULT 1 CHECK (session_number > 0),
  desired_state text NOT NULL DEFAULT 'draft' CHECK (desired_state IN
    ('draft','preparing','ready','starting','live','ending','ended','failed','cancelled')),
  observed_state text NOT NULL DEFAULT 'unconfigured' CHECK (observed_state IN
    ('unconfigured','provisioning','ready','live','interrupted','ending','processing','replay_ready','failed','ended')),
  provider_broadcast_id text,
  provider_stream_id text,
  playback_video_id text,
  playback_available boolean NOT NULL DEFAULT false,
  ingest_secret_ref text,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_metadata) = 'object'),
  scheduled_start_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_sessions_match_tenant_fk
    FOREIGN KEY (match_id, tenant_id)
    REFERENCES public.matches (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT broadcast_sessions_connection_tenant_fk
    FOREIGN KEY (connection_id, tenant_id)
    REFERENCES public.broadcast_connections (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT broadcast_sessions_destination_tenant_fk
    FOREIGN KEY (destination_id, tenant_id)
    REFERENCES public.broadcast_destinations (id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS broadcast_sessions_id_tenant_key
  ON public.broadcast_sessions (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_sessions_match_session_key
  ON public.broadcast_sessions (match_id, session_number);
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_sessions_tenant_idempotency_key
  ON public.broadcast_sessions (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS broadcast_sessions_tenant_desired_idx
  ON public.broadcast_sessions (tenant_id, desired_state, updated_at);
CREATE INDEX IF NOT EXISTS broadcast_sessions_lease_due_idx
  ON public.broadcast_sessions (lease_expires_at);

CREATE TABLE IF NOT EXISTS public.broadcast_jobs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('prepare','start','end','reconcile','archive')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','succeeded','failed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  idempotency_key text NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_jobs_attempts_check CHECK (attempts <= max_attempts),
  CONSTRAINT broadcast_jobs_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.broadcast_sessions (id, tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS broadcast_jobs_tenant_idempotency_key
  ON public.broadcast_jobs (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS broadcast_jobs_due_idx
  ON public.broadcast_jobs (state, next_attempt_at);
CREATE INDEX IF NOT EXISTS broadcast_jobs_session_idx
  ON public.broadcast_jobs (tenant_id, session_id, created_at);

CREATE TABLE IF NOT EXISTS public.broadcast_archives (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  provider_video_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','processing','ready','failed','expired')),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  available_at timestamptz,
  retention_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_archives_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.broadcast_sessions (id, tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS broadcast_archives_session_key
  ON public.broadcast_archives (session_id);
CREATE INDEX IF NOT EXISTS broadcast_archives_tenant_status_idx
  ON public.broadcast_archives (tenant_id, status);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'broadcast_connections','broadcast_destinations','broadcast_sessions',
    'broadcast_jobs','broadcast_archives'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    FOR t IN SELECT unnest(ARRAY[
      'broadcast_connections','broadcast_destinations','broadcast_sessions',
      'broadcast_jobs','broadcast_archives'
    ]) LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO ssl', t);
      EXECUTE format('CREATE POLICY %I ON public.%I TO ssl USING (true) WITH CHECK (true)',
        t || '_ssl', t);
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOR t IN SELECT unnest(ARRAY[
      'broadcast_connections','broadcast_destinations','broadcast_sessions',
      'broadcast_jobs','broadcast_archives'
    ]) LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role', t);
      EXECUTE format('CREATE POLICY %I ON public.%I TO service_role USING (true) WITH CHECK (true)',
        t || '_service', t);
    END LOOP;
  END IF;
END $$;

COMMENT ON TABLE public.broadcast_connections IS
  'ENH-08-01: tenant-owned provider account. credential_ref is an opaque secret reference, never a plaintext token.';
COMMENT ON TABLE public.broadcast_destinations IS
  'ENH-08-01: provider channel/playlist/page destination. Organization, not a privacy or ownership boundary.';
COMMENT ON TABLE public.broadcast_sessions IS
  'ENH-08-02: desired operator intent and provider-observed state are separate. Only observed live may display live.';
COMMENT ON TABLE public.broadcast_jobs IS
  'ENH-08-02: durable provider outbox with idempotency keys and bounded attempts. No provider HTTP runs inside a DB transaction.';
COMMENT ON TABLE public.broadcast_archives IS
  'ENH-08-04: replay/archive reference and retention metadata. Provider processing is not replay-ready.';

COMMIT;
