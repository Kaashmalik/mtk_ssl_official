-- Team-scoped role invitations (team manager / coach / scorer).
-- Tokens are stored as SHA-256 hashes; the plaintext is emailed once.

CREATE TABLE IF NOT EXISTS user_invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'team_manager',
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_user_invites_tenant ON user_invites(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_user_invites_email ON user_invites(email);

-- Only the platform (service_role) needs this table; PostgREST clients must not
-- read or write invite tokens.
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invites FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_invites FROM PUBLIC;
REVOKE ALL ON TABLE public.user_invites FROM anon;
REVOKE ALL ON TABLE public.user_invites FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_invites TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_invites TO ssl;
  END IF;
END $$;