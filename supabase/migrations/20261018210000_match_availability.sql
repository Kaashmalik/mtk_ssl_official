-- REG-05 availability journey (Batch 138): members record their own
-- availability for a league match, so captains/managers plan squads from
-- RECORDED answers instead of group-chat guesses.
--
-- One row per (match, person): the person is the authenticated USER (the
-- league member), not a roster player row - roster identity mapping stays
-- with the existing roster/registration flows. Re-answering updates the
-- same row in place with fresh provenance; availability is never
-- deleted, so an owner's planning view keeps the last recorded answer.
-- RLS forced; grants ssl/service_role only, no anon/authenticated access.

CREATE TABLE match_availability (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'unavailable', 'maybe')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX match_availability_match_user_uq
  ON match_availability (match_id, user_id);

CREATE INDEX match_availability_tenant_idx
  ON match_availability (tenant_id);

ALTER TABLE match_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_availability FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON match_availability TO ssl, service_role;
REVOKE ALL ON match_availability FROM anon, authenticated;

COMMENT ON TABLE match_availability IS
  'REG-05: member-recorded per-match availability (available|unavailable|maybe); one row per (match, user), updated in place with provenance';
