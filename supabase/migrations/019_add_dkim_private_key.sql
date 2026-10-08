-- Migration: Add DKIM private key column to email_domain_verifications
--
-- The DKIM signing flow previously generated an RSA keypair but discarded
-- the private key, making the generated DKIM record useless for actually
-- signing outbound email. This adds the column needed to persist the
-- private key so the mail-sending service can sign messages.
--
-- SECURITY NOTE: the private key is stored as PEM text. For production,
-- wrap this in envelope encryption (KMS/Vault) before writing, or store
-- only an opaque reference (like ssl_certificates.private_key_url) and
-- keep the actual key in a secrets manager. The column is added as plain
-- text now to unblock the signing flow; hardening is tracked separately.

ALTER TABLE email_domain_verifications
  ADD COLUMN IF NOT EXISTS dkim_private_key text;

COMMENT ON COLUMN email_domain_verifications.dkim_private_key IS
  'PEM-encoded RSA private key used to DKIM-sign outbound mail for this domain.';
