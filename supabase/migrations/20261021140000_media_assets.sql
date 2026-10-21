-- ENH-07-01 LOCAL ONLY. Apply before any media route is enabled in a deployment.
-- Additive: the legacy public.media table and its stored URLs are NOT changed
-- or approved here. Pre-contract rows read as legacy_unverified in application
-- policy until an authoritative re-check.
BEGIN;

-- One row per provider asset identity/version. `metadata` is server-only and
-- must never enter a public projection.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'cloudinary',
  provider_public_id text NOT NULL,
  provider_asset_id text,
  provider_version integer,
  resource_type text NOT NULL DEFAULT 'image',
  kind text NOT NULL CHECK (kind IN ('image','video','audio')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('legacy_unverified','pending','processing','ready','quarantined','failed','deleted')),
  publication text NOT NULL DEFAULT 'unpublished' CHECK (publication IN
    ('unpublished','published','withdrawn')),
  consent text NOT NULL DEFAULT 'not_required' CHECK (consent IN
    ('not_required','pending','granted','withdrawn')),
  mime_type text,
  format text,
  bytes bigint CHECK (bytes IS NULL OR bytes >= 0),
  width integer,
  height integer,
  duration_seconds integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  legacy_url text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  published_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT media_assets_provider_public_id_check CHECK (length(provider_public_id) BETWEEN 1 AND 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_tenant_provider_public_id_key
  ON public.media_assets (tenant_id, provider, provider_public_id);
-- Composite-FK target: the asset's tenant is part of its identity.
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_id_tenant_key
  ON public.media_assets (id, tenant_id);
CREATE INDEX IF NOT EXISTS media_assets_tenant_state_idx
  ON public.media_assets (tenant_id, state, created_at);
CREATE INDEX IF NOT EXISTS media_assets_tenant_publication_idx
  ON public.media_assets (tenant_id, publication);

-- One quota row per league. A NULL limit means "no approved quota yet":
-- reservations are REFUSED, never treated as unlimited.
CREATE TABLE IF NOT EXISTS public.media_quotas (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  limit_bytes bigint,
  used_bytes bigint NOT NULL DEFAULT 0,
  reserved_bytes bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_quotas_bytes_check CHECK (
    (limit_bytes IS NULL OR limit_bytes > 0)
    AND used_bytes >= 0 AND reserved_bytes >= 0
    AND (limit_bytes IS NULL OR used_bytes + reserved_bytes <= limit_bytes)
  )
);

CREATE TABLE IF NOT EXISTS public.media_upload_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video','audio')),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN
    ('reserved','finalized','expired','cancelled')),
  binding_type text,
  resource_id uuid,
  provider text NOT NULL DEFAULT 'cloudinary',
  provider_public_id text NOT NULL,
  provider_folder text,
  declared_mime_type text NOT NULL,
  declared_bytes bigint NOT NULL,
  reserved_bytes bigint NOT NULL,
  asset_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT media_upload_sessions_bytes_check CHECK (
    declared_bytes > 0 AND reserved_bytes > 0 AND reserved_bytes >= declared_bytes
  ),
  CONSTRAINT media_upload_sessions_binding_check CHECK (
    (binding_type IS NULL AND resource_id IS NULL)
    OR (binding_type IN ('tournament','venue','branding','team','player','match')
        AND resource_id IS NOT NULL)
  ),
  CONSTRAINT media_upload_sessions_asset_tenant_fk
    FOREIGN KEY (asset_id, tenant_id) REFERENCES public.media_assets (id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS media_upload_sessions_tenant_provider_public_id_key
  ON public.media_upload_sessions (tenant_id, provider, provider_public_id);
CREATE INDEX IF NOT EXISTS media_upload_sessions_due_idx
  ON public.media_upload_sessions (expires_at) WHERE state = 'reserved';

-- Same-tenant binding is a DATABASE constraint: a cross-tenant asset cannot be
-- attached even by a buggy caller.
CREATE TABLE IF NOT EXISTS public.media_bindings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN
    ('tournament','venue','branding','team','player','match')),
  resource_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN
    ('logo','banner','gallery','highlight','thumbnail','avatar')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_bindings_asset_tenant_fk
    FOREIGN KEY (asset_id, tenant_id) REFERENCES public.media_assets (id, tenant_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS media_bindings_asset_resource_role_key
  ON public.media_bindings (asset_id, resource_type, resource_id, role);
CREATE INDEX IF NOT EXISTS media_bindings_resource_idx
  ON public.media_bindings (tenant_id, resource_type, resource_id);

CREATE TABLE IF NOT EXISTS public.media_consents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  subject_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('not_required','pending','granted','withdrawn')),
  evidence_ref text,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_consents_asset_tenant_fk
    FOREIGN KEY (asset_id, tenant_id) REFERENCES public.media_assets (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT media_consents_withdrawal_check CHECK (
    (state <> 'granted' OR granted_at IS NOT NULL)
    AND (state <> 'withdrawn' OR withdrawn_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS media_consents_subject_purpose_key
  ON public.media_consents (asset_id, subject_user_id, purpose)
  WHERE subject_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS media_consents_asset_purpose_key
  ON public.media_consents (asset_id, purpose)
  WHERE subject_user_id IS NULL;

-- Webhook journal: dedup identity is the provider event id (or a content hash),
-- never a timestamp. Malformed/unknown-tenant bodies are quarantined, not lost.
CREATE TABLE IF NOT EXISTS public.media_processing_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid,
  provider text NOT NULL DEFAULT 'cloudinary',
  provider_event_id text NOT NULL,
  dedup_key text NOT NULL,
  payload_hash text,
  state text NOT NULL DEFAULT 'received' CHECK (state IN
    ('received','applied','quarantined','duplicate','failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE UNIQUE INDEX IF NOT EXISTS media_processing_events_dedup_key
  ON public.media_processing_events (dedup_key);
CREATE INDEX IF NOT EXISTS media_processing_events_asset_idx
  ON public.media_processing_events (asset_id, received_at);

-- Durable destruction/invalidation outbox. Provider identity is kept even when
-- the asset becomes a tombstone, so an operation can always be retried.
CREATE TABLE IF NOT EXISTS public.media_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid,
  provider text NOT NULL DEFAULT 'cloudinary',
  provider_public_id text NOT NULL,
  provider_resource_type text NOT NULL DEFAULT 'image',
  action text NOT NULL CHECK (action IN ('destroy_provider_asset','invalidate_delivery')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending','leased','provider_destroyed','failed','dead_lettered')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT media_cleanup_jobs_asset_tenant_fk
    FOREIGN KEY (asset_id, tenant_id) REFERENCES public.media_assets (id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS media_cleanup_jobs_asset_action_key
  ON public.media_cleanup_jobs (asset_id, action);
CREATE UNIQUE INDEX IF NOT EXISTS media_cleanup_jobs_provider_public_action_key
  ON public.media_cleanup_jobs (tenant_id, provider, provider_public_id, action);
CREATE INDEX IF NOT EXISTS media_cleanup_jobs_due_idx
  ON public.media_cleanup_jobs (next_attempt_at, id)
  WHERE state IN ('pending','leased');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'media_assets','media_quotas','media_upload_sessions','media_bindings',
    'media_consents','media_processing_events','media_cleanup_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    FOR t IN SELECT unnest(ARRAY[
      'media_assets','media_quotas','media_upload_sessions','media_bindings',
      'media_consents','media_processing_events','media_cleanup_jobs'
    ]) LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO ssl', t);
      EXECUTE format('CREATE POLICY %I ON public.%I TO ssl USING (true) WITH CHECK (true)',
        t || '_ssl', t);
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOR t IN SELECT unnest(ARRAY[
      'media_assets','media_quotas','media_upload_sessions','media_bindings',
      'media_consents','media_processing_events','media_cleanup_jobs'
    ]) LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role', t);
      EXECUTE format('CREATE POLICY %I ON public.%I TO service_role USING (true) WITH CHECK (true)',
        t || '_service', t);
    END LOOP;
  END IF;
END $$;

COMMENT ON TABLE public.media_assets IS
  'ENH-07-01: verified provider asset identity/version. metadata is server-only; publication requires ready state AND settled consent.';
COMMENT ON TABLE public.media_upload_sessions IS
  'ENH-07-01: one authorized upload with quota reserved until finalize/expiry. provider_public_id is server-chosen and unpredictable.';
COMMENT ON TABLE public.media_bindings IS
  'ENH-07-01: same-tenant attachment to a domain resource, enforced by a composite (asset_id, tenant_id) foreign key.';
COMMENT ON TABLE public.media_consents IS
  'ENH-07-01: per-purpose consent evidence reference (never raw identity documents); withdrawal is independent of deletion.';
COMMENT ON TABLE public.media_processing_events IS
  'ENH-07-01: webhook dedup/quarantine journal keyed by provider event id, never by timestamp.';
COMMENT ON TABLE public.media_cleanup_jobs IS
  'ENH-07-01: durable provider destruction/invalidation outbox; identity survives the asset tombstone.';
COMMENT ON TABLE public.media_quotas IS
  'ENH-07-01: atomic per-league byte reservation. A NULL limit refuses reservations until an approved quota exists.';

COMMIT;
