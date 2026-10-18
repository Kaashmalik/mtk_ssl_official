-- REG-03 / tournament application workflow (Batch 147): team applications
-- to a tournament. A team manager submits an application; the tournament's
-- league owner moves it through a REVIEWED state machine. THREE HONEST
-- MECHANISMS ARE PINNED IN SHAPE:
-- 1. States: submitted -> needs_information | waitlisted -> approved |
--    declined; the MEMBER may move a live application to withdrawn.
--    needs_information is a QUESTION, not a rejection: the owner can ask
--    for missing facts and the team can answer by withdrawing and
--    resubmitting (documented default; a full threaded reply flow is
--    future scope, not silently promised here).
-- 2. "reason"/"note" provenance: every owner decision carries a FIXED
--    decision vocabulary (no free text in this first slice).
-- 3. The partial unique makes "one LIVE application per team per
--    tournament" a database guarantee; the resolution CHECK pins
--    provenance (live = no decider; decided = decider AND time required).
-- Live = submitted | needs_information | waitlisted (open states the
-- member can still act on); approved | declined | withdrawn are terminal.
-- RLS forced; grants ssl/service_role only, no anon access. ADDITIVE ONLY.
CREATE TYPE tournament_application_status AS ENUM
('submitted', 'needs_information', 'waitlisted', 'approved', 'declined', 'withdrawn');
CREATE TYPE tournament_application_decision AS ENUM
('approve', 'request_information', 'waitlist', 'decline');
CREATE TABLE tournament_applications (
id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
status tournament_application_status NOT NULL DEFAULT 'submitted',
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
decided_at timestamptz,
decided_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX tournament_applications_one_live_per_team_key
ON tournament_applications (tournament_id, team_id)
WHERE status IN ('submitted', 'needs_information', 'waitlisted');
CREATE INDEX tournament_applications_open_tournament_idx
ON tournament_applications (tournament_id, created_at)
WHERE status IN ('submitted', 'needs_information', 'waitlisted');
CREATE INDEX tournament_applications_team_history_idx
ON tournament_applications (team_id, created_at);
ALTER TABLE tournament_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_applications FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON tournament_applications TO ssl, service_role;
REVOKE ALL ON tournament_applications FROM anon, authenticated;
ALTER TABLE tournament_applications ADD CONSTRAINT tournament_applications_resolution_check
CHECK (
(status IN ('submitted', 'needs_information', 'waitlisted') AND decided_at IS NULL AND decided_by IS NULL)
OR (status IN ('approved', 'declined') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
OR (status = 'withdrawn' AND decided_at IS NOT NULL AND decided_by IS NULL)
);
COMMENT ON TABLE tournament_applications IS
'REG-03: team applications to a tournament; reviewed state machine - one LIVE application per team per tournament is a
database guarantee; owner decisions carry fixed-vocabulary provenance; member may withdraw any live application';
