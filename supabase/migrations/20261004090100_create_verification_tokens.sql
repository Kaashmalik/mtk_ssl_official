-- Verification tokens for multi-channel OTP (registration, password reset, renewal, admin 2FA)
-- Codes are stored as HMAC-SHA256 hashes, never plaintext.

CREATE TABLE IF NOT EXISTS verification_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  identifier text NOT NULL,
  token_hash text NOT NULL,
  channel text NOT NULL,
  purpose text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_identifier
  ON verification_tokens(identifier, purpose);

-- Opportunistic cleanup of expired/verified rows (called by the renewal cron).
CREATE OR REPLACE FUNCTION cleanup_verification_tokens()
RETURNS integer AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM verification_tokens
  WHERE expires_at < now() - interval '1 day'
     OR (verified_at IS NOT NULL AND verified_at < now() - interval '1 day');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;