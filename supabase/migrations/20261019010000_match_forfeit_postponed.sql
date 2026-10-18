-- COMP-07 (Batch 153): forfeit and postponement states for matches.
-- A match can be FORFEITED (one side fails to appear / concedes) or
-- POSTPONED (rescheduled) by the league owner. Both are terminal-ish
-- outcomes that carry a reason and, for postponement, a new scheduled
-- date (matches.scheduled_date already exists). ADD VALUE is safe on the
-- existing enum and additive; the reason columns are nullable so legacy
-- rows stay valid. No RLS change (matches already has RLS forced + grants).
ALTER TYPE match_status ADD VALUE IF NOT EXISTS 'forfeited';
ALTER TYPE match_status ADD VALUE IF NOT EXISTS 'postponed';
ALTER TABLE matches ADD COLUMN forfeit_reason text;
ALTER TABLE matches ADD COLUMN postponement_reason text;
COMMENT ON COLUMN matches.forfeit_reason IS
'COMP-07: human-readable reason when a match is forfeited; NULL otherwise';
COMMENT ON COLUMN matches.postponement_reason IS
'COMP-07: human-readable reason when a match is postponed; NULL otherwise';
