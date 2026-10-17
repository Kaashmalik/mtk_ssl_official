-- COMP-07 competition locks: explicit fixture freeze for a competition.
-- Engagement is EXPLICIT ONLY (audited setCompetitionLock by a league
-- owner); status transitions never set or clear these columns, so there
-- is no backfill: pre-existing competitions start unlocked, which is the
-- recorded truth about what their leagues actually decided.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS competition_locked_at timestamptz;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS competition_locked_by uuid REFERENCES users(id);

COMMENT ON COLUMN tournaments.competition_locked_at IS
  'COMP-07: set only by the audited competition-lock writer; NULL means the league has not frozen fixtures. Enforced for fixture create/update/cancel/reschedule, never for broadcast controls.';
COMMENT ON COLUMN tournaments.competition_locked_by IS
  'COMP-07: league owner who placed (and last moved) the lock; kept for provenance, not consulted by lock decisions.';
