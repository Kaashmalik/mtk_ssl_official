-- REG-05 / reviewed-correction workflow (Batch 141): scorecard correction
-- requests. A league member's formal request to review an official
-- scorecard. CORRECTION REQUESTS ARE RECORDS, NEVER MUTATIONS: raising one
-- does not change the scorecard, and even an approved request does not
-- auto-edit anything - the owner corrects data through the existing
-- audited scoring paths, keeping the review and correction authorities
-- apart (same discipline as award disputes, Batch P4/88).
-- Reasons are a FIXED set (no free text in this first slice). Status is
-- the state machine open -> approved | dismissed, terminal either way.
-- The partial unique makes "one OPEN request per member per match" a
-- database guarantee; the resolution CHECK pins provenance (open = no
-- reviewer; decided = reviewer AND time required).
-- RLS forced; grants ssl/service_role only, no anon access.

CREATE TYPE scorecard_correction_reason AS ENUM
  ('wrong_runs', 'wrong_wicket', 'wrong_batter', 'missing_player', 'other');

CREATE TYPE scorecard_correction_status AS ENUM
  ('open', 'approved', 'dismissed');

CREATE TABLE scorecard_correction_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason scorecard_correction_reason NOT NULL,
  status scorecard_correction_status NOT NULL DEFAULT 'open',
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX scorecard_correction_requests_one_open_per_member_key
  ON scorecard_correction_requests (match_id, requested_by)
  WHERE status = 'open';

CREATE INDEX scorecard_correction_requests_open_match_idx
  ON scorecard_correction_requests (match_id)
  WHERE status = 'open';

CREATE INDEX scorecard_correction_requests_tenant_open_idx
  ON scorecard_correction_requests (tenant_id, raised_at)
  WHERE status = 'open';

ALTER TABLE scorecard_correction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_correction_requests FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON scorecard_correction_requests TO ssl, service_role;
REVOKE ALL ON scorecard_correction_requests FROM anon, authenticated;

ALTER TABLE scorecard_correction_requests ADD CONSTRAINT scorecard_correction_requests_resolution_check
  CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status IN ('approved', 'dismissed') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  );

COMMENT ON TABLE scorecard_correction_requests IS
  'REG-05: member-raised scorecard correction requests; records never mutations - one OPEN request per member per match, resolution provenance CHECK-enforced';
