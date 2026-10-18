-- COMP-03 creation recovery (Batch 136): idempotent tournament creation.
--
-- A tournament creation that fails on the wire (timeout, refresh mid-submit
-- leaves the durable draft intact but the server answer lost) can be
-- retried with the SAME request key and must return the SAME tournament,
-- never a silent duplicate. The client wizard generates a uuid when the
-- form opens and persists it inside its durable draft, so even a
-- refresh-close-reopen keeps one key per intended creation.
-- Replay is a pure read (no second audit row) per the house replay rule.

ALTER TABLE tournaments
  ADD COLUMN creation_request_key uuid;

CREATE UNIQUE INDEX tournaments_tenant_creation_key_uq
  ON tournaments (tenant_id, creation_request_key)
  WHERE creation_request_key IS NOT NULL;

COMMENT ON COLUMN tournaments.creation_request_key IS
  'COMP-03: client-supplied idempotency key for creation recovery; a retried create with the same key returns the first tournament instead of duplicating';
