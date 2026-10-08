-- ============================================================================
-- Migration 020: Restore Missing Tables (documents, media, impersonation_sessions)
-- ============================================================================
-- These tables were defined in migrations 002 and 018 but are missing from the
-- live database (likely lost during project pause/restore).

-- ============================================================================
-- DOCUMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size bigint,
  category text,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);

-- ============================================================================
-- MEDIA
-- ============================================================================
CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL,
  mime_type text,
  file_size bigint,
  width integer,
  height integer,
  duration integer,
  thumbnail_url text,
  category text,
  related_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  related_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  related_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_tenant_id ON media(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_file_type ON media(file_type);
CREATE INDEX IF NOT EXISTS idx_media_category ON media(category);
CREATE INDEX IF NOT EXISTS idx_media_related_match_id ON media(related_match_id);
CREATE INDEX IF NOT EXISTS idx_media_related_team_id ON media(related_team_id);
CREATE INDEX IF NOT EXISTS idx_media_related_player_id ON media(related_player_id);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_by ON media(uploaded_by);

-- ============================================================================
-- IMPERSONATION SESSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  jti           text        NOT NULL,
  admin_user_id text        NOT NULL,
  admin_email   text        NOT NULL,
  target_user_id uuid       NOT NULL,
  target_email  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued','active','revoked','expired')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz NOT NULL,
  issued_from_ip text,
  user_agent    text,
  reason        text
);

CREATE UNIQUE INDEX IF NOT EXISTS impersonation_active_jti_uniq
  ON impersonation_sessions (jti)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_impersonation_admin
  ON impersonation_sessions (admin_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_target
  ON impersonation_sessions (target_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_expires
  ON impersonation_sessions (expires_at)
  WHERE status IN ('issued','active');

-- ============================================================================
-- TRIGGERS for updated_at on restored tables
-- ============================================================================
DO $$
BEGIN
  -- documents trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_documents_updated_at') THEN
    CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  -- media trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_updated_at') THEN
    CREATE TRIGGER update_media_updated_at BEFORE UPDATE ON media
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
